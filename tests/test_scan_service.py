import json
import os
import queue
import tempfile
import threading
import time
import unittest
from unittest import mock

from PIL import Image, PngImagePlugin

from _loader import load_module

import _tmp

scan_service = load_module("scan_service")
folder_scanner = load_module("folder_scanner")


def _write_png(path, size=(8, 8), prompt=None, workflow=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    info = PngImagePlugin.PngInfo()
    if prompt is not None:
        info.add_text("prompt", json.dumps(prompt))
    if workflow is not None:
        info.add_text("workflow", json.dumps(workflow))
    with Image.new("RGB", size, (200, 30, 30)) as image:
        image.save(path, pnginfo=info)


class ScanServiceTest(unittest.TestCase):
    def setUp(self):
        scan_service.invalidate()
        self.temp = _tmp.TempDir(prefix="gallery-scan-")
        self.root = self.temp.name

    def tearDown(self):
        scan_service.invalidate()
        self.temp.cleanup()

    def test_single_flight_concurrent_callers_share_one_scan(self):
        calls = []
        barrier = threading.Barrier(4)

        def fake_scan(root, base_name, include_subfolders, extensions, dedup,
                      extract_metadata=True, timing=None):
            calls.append((root, base_name, extract_metadata))
            if timing is not None:
                timing["metadata_ms"] = 0.0
            time.sleep(0.25)
            return ({"gallery": {"a.png": {"name": "a.png", "metadata": {}}}}, False)

        results = []
        errors = []
        lock = threading.Lock()

        def worker():
            try:
                barrier.wait(timeout=5)
                result = scan_service.get_scan(self.root, "gallery", [".png"], True, False)
                with lock:
                    results.append(result)
            except Exception as exc:  # pragma: no cover - failure path
                with lock:
                    errors.append(exc)

        with mock.patch.object(scan_service, "_scan_impl", side_effect=fake_scan):
            threads = [threading.Thread(target=worker) for _ in range(4)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)

        self.assertEqual(errors, [])
        self.assertEqual(len(calls), 1, "concurrent callers must share one real scan")
        self.assertEqual(len(results), 4)
        infos = [info for _folders, info in results]
        self.assertEqual(sum(1 for info in infos if not info["cache_hit"]), 1)
        self.assertEqual(sum(1 for info in infos if info["joined_inflight"]), 3)
        for folders, info in results:
            self.assertIn("gallery", folders)
            self.assertEqual(info["files"], 1)

    def test_soft_invalidate_keeps_inflight_scan_joinable(self):
        calls = []
        started = threading.Event()

        def slow_scan(root, base_name, include_subfolders, extensions, dedup,
                      extract_metadata=True, timing=None):
            calls.append(1)
            started.set()
            time.sleep(0.25)
            return ({"gallery": {"a.png": {}}}, False)

        results = []

        def waiter():
            results.append(scan_service.get_scan(self.root, "gallery", [".png"], True, False))

        with mock.patch.object(scan_service, "_scan_impl", side_effect=slow_scan):
            leader = threading.Thread(
                target=lambda: scan_service.get_scan(self.root, "gallery", [".png"], True, False)
            )
            leader.start()
            self.assertTrue(started.wait(timeout=5))

            # This is what monitor start does: drop completed entries but keep
            # the in-flight scan so startup does not scan twice.
            scan_service.invalidate(self.root, drop_inflight=False)
            follower = threading.Thread(target=waiter)
            follower.start()
            leader.join(timeout=10)
            follower.join(timeout=10)

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 1)
        _folders, info = results[0]
        self.assertTrue(info["cache_hit"])
        self.assertTrue(info["joined_inflight"])

    def test_ttl_cache_and_invalidate(self):
        calls = []

        def fake_scan(root, base_name, include_subfolders, extensions, dedup,
                      extract_metadata=True, timing=None):
            calls.append(1)
            return ({"gallery": {"a.png": {}}}, False)

        with mock.patch.object(scan_service, "_scan_impl", side_effect=fake_scan):
            _folders, first = scan_service.get_scan(self.root, "gallery", [".png"], True, False)
            self.assertFalse(first["cache_hit"])
            _folders, second = scan_service.get_scan(self.root, "gallery", [".png"], True, False)
            self.assertTrue(second["cache_hit"])
            self.assertGreaterEqual(second["cache_age_ms"], 0.0)
            self.assertEqual(len(calls), 1)

            scan_service.invalidate(self.root)
            _folders, third = scan_service.get_scan(self.root, "gallery", [".png"], True, False)
            self.assertFalse(third["cache_hit"])
            self.assertEqual(len(calls), 2)

    def test_cache_key_includes_metadata_flag(self):
        seen = []

        def fake_scan(root, base_name, include_subfolders, extensions, dedup,
                      extract_metadata=True, timing=None):
            seen.append(extract_metadata)
            return ({}, False)

        with mock.patch.object(scan_service, "_scan_impl", side_effect=fake_scan):
            scan_service.get_scan(self.root, "gallery", [".png"], True, False)
            scan_service.get_scan(self.root, "gallery", [".png"], True, True)
        self.assertEqual(seen, [False, True])

    def test_scan_without_metadata_never_opens_images(self):
        _write_png(os.path.join(self.root, "a.png"), prompt={"1": {"class_type": "X"}})
        _write_png(os.path.join(self.root, "sub", "b.png"))

        with mock.patch.object(
            folder_scanner, "buildMetadata", side_effect=AssertionError("Pillow was opened")
        ):
            folders, changed = folder_scanner._scan_for_images(
                self.root, "gallery", True, [".png"], True, extract_metadata=False
            )

        self.assertFalse(changed)
        files = {name for folder in folders.values() for name in folder}
        self.assertEqual(files, {"a.png", "b.png"})
        for folder in folders.values():
            for asset in folder.values():
                self.assertEqual(asset["metadata"], {})
                self.assertEqual(asset["type"], "image")
                self.assertTrue(asset["url"].startswith("/static_gallery/"))

    def test_scan_with_metadata_fills_it(self):
        _write_png(
            os.path.join(self.root, "a.png"),
            size=(12, 7),
            prompt={"1": {"class_type": "KSampler"}},
            workflow={"nodes": []},
        )
        folders, _changed = folder_scanner._scan_for_images(
            self.root, "gallery", True, [".png"], True, extract_metadata=True
        )
        asset = folders["gallery"]["a.png"]
        self.assertEqual(asset["metadata"]["fileinfo"]["resolution"], "12x7")
        self.assertEqual(asset["metadata"]["prompt"], {"1": {"class_type": "KSampler"}})
        self.assertEqual(asset["metadata"]["workflow"], {"nodes": []})

    def test_metadata_timing_is_reported(self):
        _write_png(os.path.join(self.root, "a.png"))
        timing = {}
        folder_scanner._scan_for_images(
            self.root, "gallery", True, [".png"], True,
            extract_metadata=True, timing=timing,
        )
        self.assertIn("metadata_ms", timing)
        self.assertGreaterEqual(timing["metadata_ms"], 0.0)


if __name__ == "__main__":
    unittest.main()
