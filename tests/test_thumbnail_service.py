import io
import os
import tempfile
import threading
import time
import unittest
from unittest import mock

from PIL import Image

from _loader import load_module

import _tmp

thumbnail_service = load_module("thumbnail_service")


def _write_image(path, size, mode="RGB", fmt="PNG", exif_orientation=None):
    image = Image.new(mode, size)
    pixels = image.load()
    width, height = size
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            color = (x * 255 // max(width, 1), y * 255 // max(height, 1), (x + y) % 256)
            if mode == "RGBA":
                color = color + (200,)
            for dy in range(4):
                for dx in range(4):
                    if x + dx < width and y + dy < height:
                        pixels[x + dx, y + dy] = color
    if exif_orientation is not None:
        exif = Image.Exif()
        exif[274] = exif_orientation
        image.save(path, format=fmt, exif=exif)
    else:
        image.save(path, format=fmt)
    image.close()


class ThumbnailServiceTest(unittest.TestCase):
    def setUp(self):
        thumbnail_service.clear_all()
        self.temp = _tmp.TempDir(prefix="gallery-thumb-")
        self.cache_dir = os.path.join(self.temp.name, "cache")
        thumbnail_service.set_cache_dir(self.cache_dir)
        self.path = os.path.join(self.temp.name, "big.png")
        _write_image(self.path, (800, 600))

    def tearDown(self):
        thumbnail_service.clear_all()
        thumbnail_service.set_cache_dir(None)
        self.temp.cleanup()

    def test_generates_smaller_webp_and_then_hits_disk_cache(self):
        original_size = os.path.getsize(self.path)
        data, content_type, cache_hit = thumbnail_service.get_thumbnail(self.path, 200)
        self.assertFalse(cache_hit)
        self.assertEqual(content_type, "image/webp")
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(data[8:12], b"WEBP")
        self.assertLess(len(data), original_size)

        with Image.open(io.BytesIO(data)) as thumb:
            self.assertLessEqual(max(thumb.size), 200)
            self.assertAlmostEqual(thumb.size[0] / thumb.size[1], 800 / 600, places=1)

        cache_file = thumbnail_service.cache_path(self.path, 200)
        self.assertTrue(os.path.isfile(cache_file))

        data2, _content_type, cache_hit2 = thumbnail_service.get_thumbnail(self.path, 200)
        self.assertTrue(cache_hit2)
        self.assertEqual(data, data2)

    def test_cache_key_changes_with_mtime(self):
        first, _ctype, first_hit = thumbnail_service.get_thumbnail(self.path, 128)
        self.assertFalse(first_hit)
        first_cache_file = thumbnail_service.cache_path(self.path, 128)
        stat = os.stat(self.path)
        os.utime(self.path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
        second, _ctype, second_hit = thumbnail_service.get_thumbnail(self.path, 128)
        self.assertFalse(second_hit)
        second_cache_file = thumbnail_service.cache_path(self.path, 128)
        self.assertNotEqual(first_cache_file, second_cache_file)

    def test_concurrent_requests_generate_once(self):
        original_generate = thumbnail_service._generate
        calls = []

        def counted(real_path, width):
            calls.append((real_path, width))
            time.sleep(0.15)
            return original_generate(real_path, width)

        results = []

        def worker():
            results.append(thumbnail_service.get_thumbnail(self.path, 256))

        with mock.patch.object(thumbnail_service, "_generate", side_effect=counted):
            threads = [threading.Thread(target=worker) for _ in range(6)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 6)
        self.assertEqual(sum(1 for _d, _t, hit in results if not hit), 1)

    def test_exif_orientation_is_applied(self):
        jpeg_path = os.path.join(self.temp.name, "rotated.jpg")
        _write_image(jpeg_path, (400, 200), fmt="JPEG", exif_orientation=6)
        data, _content_type, _hit = thumbnail_service.get_thumbnail(jpeg_path, 100)
        with Image.open(io.BytesIO(data)) as thumb:
            self.assertEqual(thumb.size, (50, 100))

    def test_invalid_width(self):
        for width in (0, 32, 2048, "abc", None):
            with self.subTest(width=width):
                with self.assertRaises(thumbnail_service.ThumbnailError) as ctx:
                    thumbnail_service.get_thumbnail(self.path, width)
                self.assertEqual(ctx.exception.status, 400)

    def test_unsupported_media(self):
        video = os.path.join(self.temp.name, "clip.mp4")
        with open(video, "wb") as handle:
            handle.write(b"\x00" * 16)
        with self.assertRaises(thumbnail_service.ThumbnailError) as ctx:
            thumbnail_service.get_thumbnail(video, 128)
        self.assertEqual(ctx.exception.status, 415)

    def test_missing_file(self):
        with self.assertRaises(thumbnail_service.ThumbnailError) as ctx:
            thumbnail_service.get_thumbnail(os.path.join(self.temp.name, "nope.png"), 128)
        self.assertEqual(ctx.exception.status, 404)

    def test_invalidate_removes_generated_files(self):
        thumbnail_service.get_thumbnail(self.path, 128)
        cache_file = thumbnail_service.cache_path(self.path, 128)
        self.assertTrue(os.path.isfile(cache_file))
        thumbnail_service.invalidate(self.path)
        self.assertFalse(os.path.isfile(cache_file))


if __name__ == "__main__":
    unittest.main()
