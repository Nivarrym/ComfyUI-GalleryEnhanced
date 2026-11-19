import os
import tempfile
import unittest

from _loader import load_module

import _tmp

gallery_paths = load_module("gallery_paths")


class GalleryPathsTest(unittest.TestCase):
    def setUp(self):
        self.temp = _tmp.TempDir(prefix="gallery-paths-")
        self.root = os.path.join(self.temp.name, "gallery")
        os.makedirs(os.path.join(self.root, "sub"))
        self.image = os.path.join(self.root, "sub", "my image.png")
        with open(self.image, "wb") as handle:
            handle.write(b"not really a png")
        self.outside = os.path.join(self.temp.name, "outside.txt")
        with open(self.outside, "wb") as handle:
            handle.write(b"secret")

    def tearDown(self):
        self.temp.cleanup()

    def test_resolves_static_url(self):
        resolved = gallery_paths.resolve_gallery_path(self.root, "/static_gallery/sub/my%20image.png")
        self.assertEqual(os.path.realpath(resolved.path), os.path.realpath(self.image))
        self.assertEqual(resolved.relative, "sub/my image.png")
        self.assertEqual(resolved.root, os.path.realpath(self.root))

    def test_resolves_plain_name(self):
        resolved = gallery_paths.resolve_gallery_path(self.root, "/static_gallery/sub/./my image.png")
        self.assertTrue(os.path.isfile(resolved.path))

    def test_missing_file_still_resolves(self):
        resolved = gallery_paths.resolve_gallery_path(self.root, "/static_gallery/nope.png")
        self.assertTrue(resolved.path.endswith("nope.png"))

    def test_rejects_traversal(self):
        for value in (
            "/static_gallery/../outside.txt",
            "/static_gallery/sub/../../outside.txt",
            "/static_gallery/%2e%2e/outside.txt",
            "/static_gallery/sub/%2E%2E/%2E%2E/outside.txt",
            "/static_gallery/..\\outside.txt",
        ):
            with self.subTest(value=value):
                with self.assertRaises(gallery_paths.GalleryPathError) as ctx:
                    gallery_paths.resolve_gallery_path(self.root, value)
                self.assertEqual(ctx.exception.status, 400)

    def test_rejects_absolute_and_foreign_paths(self):
        for value in (
            "C:/Windows/win.ini",
            "C:\\Windows\\win.ini",
            "/etc/passwd",
            "\\\\server\\share\\file.png",
            "/static_gallery/C:/Windows/win.ini",
        ):
            with self.subTest(value=value):
                with self.assertRaises(gallery_paths.GalleryPathError) as ctx:
                    gallery_paths.resolve_gallery_path(self.root, value)
                self.assertIn(ctx.exception.status, (400, 403))

    def test_rejects_root_and_empty(self):
        with self.assertRaises(gallery_paths.GalleryPathError) as ctx:
            gallery_paths.resolve_gallery_path(self.root, "/static_gallery/")
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(gallery_paths.GalleryPathError):
            gallery_paths.resolve_gallery_path(self.root, "")

    def test_rejects_symlink_escape(self):
        link = os.path.join(self.root, "link-out")
        try:
            os.symlink(self.outside, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are not available on this machine")
        with self.assertRaises(gallery_paths.GalleryPathError) as ctx:
            gallery_paths.resolve_gallery_path(self.root, "/static_gallery/link-out")
        self.assertEqual(ctx.exception.status, 403)

    def test_local_path_modes(self):
        inside = gallery_paths.resolve_local_path(self.root, self.image)
        self.assertEqual(os.path.realpath(inside.path), os.path.realpath(self.image))

        relative = gallery_paths.resolve_local_path(self.root, "gallery/sub/my image.png")
        self.assertEqual(os.path.realpath(relative.path), os.path.realpath(self.image))

        url = gallery_paths.resolve_local_path(self.root, "/static_gallery/sub/my%20image.png")
        self.assertEqual(os.path.realpath(url.path), os.path.realpath(self.image))

        with self.assertRaises(gallery_paths.GalleryPathError) as ctx:
            gallery_paths.resolve_local_path(self.root, self.outside)
        self.assertEqual(ctx.exception.status, 403)


if __name__ == "__main__":
    unittest.main()
