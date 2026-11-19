import json
import os
import tempfile
import unittest

from PIL import Image, PngImagePlugin

from _loader import load_module

import _tmp

metadata_service = load_module("metadata_service")


def _write_png(path, size=(8, 8), prompt=None, workflow=None):
    info = PngImagePlugin.PngInfo()
    if prompt is not None:
        info.add_text("prompt", json.dumps(prompt))
    if workflow is not None:
        info.add_text("workflow", json.dumps(workflow))
    with Image.new("RGB", size, (10, 120, 200)) as image:
        image.save(path, pnginfo=info)


class MetadataServiceTest(unittest.TestCase):
    def setUp(self):
        metadata_service.invalidate_all()
        metadata_service.configure(512)
        self.temp = _tmp.TempDir(prefix="gallery-meta-")
        self.path = os.path.join(self.temp.name, "asset.png")
        _write_png(self.path, size=(16, 9), prompt={"3": {"class_type": "SaveImage"}})

    def tearDown(self):
        metadata_service.invalidate_all()
        self.temp.cleanup()

    def test_extracts_and_caches(self):
        metadata, cached = metadata_service.get_metadata(self.path)
        self.assertFalse(cached)
        self.assertEqual(metadata["fileinfo"]["resolution"], "16x9")
        self.assertEqual(metadata["prompt"], {"3": {"class_type": "SaveImage"}})

        again, cached_again = metadata_service.get_metadata(self.path)
        self.assertTrue(cached_again)
        self.assertIs(again, metadata)
        self.assertEqual(metadata_service.size(), 1)

    def test_invalidate_forces_reparse(self):
        metadata_service.get_metadata(self.path)
        metadata_service.invalidate(self.path)
        self.assertEqual(metadata_service.size(), 0)
        _metadata, cached = metadata_service.get_metadata(self.path)
        self.assertFalse(cached)

    def test_mtime_or_size_change_is_a_new_key(self):
        metadata_service.get_metadata(self.path)
        _write_png(self.path, size=(32, 18))
        metadata, cached = metadata_service.get_metadata(self.path)
        self.assertFalse(cached)
        self.assertEqual(metadata["fileinfo"]["resolution"], "32x18")

    def test_file_handle_is_closed_after_extraction(self):
        # On Windows an open handle makes os.remove fail; this used to leak one
        # handle per scanned image.
        metadata_service.get_metadata(self.path)
        os.remove(self.path)
        self.assertFalse(os.path.exists(self.path))

    def test_lru_eviction(self):
        metadata_service.configure(1)
        second = os.path.join(self.temp.name, "second.png")
        _write_png(second)
        metadata_service.get_metadata(self.path)
        metadata_service.get_metadata(second)
        self.assertEqual(metadata_service.size(), 1)

    def test_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            metadata_service.get_metadata(os.path.join(self.temp.name, "nope.png"))


if __name__ == "__main__":
    unittest.main()
