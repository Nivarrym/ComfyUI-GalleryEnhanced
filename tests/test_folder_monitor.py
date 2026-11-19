import os
import tempfile
import time
import unittest
from unittest import mock

import _loader
import _comfy_stubs
import _tmp

_loader.load_package()
_comfy_stubs.install()

folder_monitor = _loader.load_module("folder_monitor")
scan_service = _loader.load_module("scan_service")

from watchdog.observers import Observer  # noqa: E402
from watchdog.observers.polling import PollingObserver  # noqa: E402


class FolderMonitorTest(unittest.TestCase):
    def setUp(self):
        scan_service.invalidate()
        self.temp = _tmp.TempDir(prefix="gallery-monitor-")
        self.root = self.temp.name
        with open(os.path.join(self.root, "a.png"), "wb") as handle:
            handle.write(b"\x89PNG\r\n\x1a\n")

    def tearDown(self):
        scan_service.invalidate()
        self.temp.cleanup()

    def test_observer_types_are_not_swapped(self):
        native = folder_monitor.FileSystemMonitor(self.root, use_polling_observer=False)
        polling = folder_monitor.FileSystemMonitor(self.root, use_polling_observer=True)
        self.assertIsInstance(native.observer, Observer)
        self.assertNotIsInstance(native.observer, PollingObserver)
        self.assertIsInstance(polling.observer, PollingObserver)

    def test_initial_scan_uses_scan_service_without_metadata(self):
        recorded = {}

        def fake_get_scan(root, base_name=None, extensions=None,
                          deduplicate_symlinks=True, extract_metadata=False, ttl=2.0):
            recorded.update(
                root=root,
                base_name=base_name,
                extensions=extensions,
                extract_metadata=extract_metadata,
            )
            return ({"gallery": {"a.png": {}}}, {"cache_hit": False, "files": 1})

        monitor = folder_monitor.FileSystemMonitor(self.root)
        with mock.patch.object(scan_service, "get_scan", side_effect=fake_get_scan):
            monitor._initial_scan()

        self.assertEqual(recorded["root"], self.root)
        self.assertFalse(recorded["extract_metadata"])
        self.assertEqual(monitor.event_handler.last_known_folders, {"gallery": {"a.png": {}}})

    def test_rescan_invalidates_cache_and_emits_changes(self):
        handler = folder_monitor.GalleryEventHandler(self.root, extensions=[".png"])
        handler.last_known_folders = {}
        sent = []

        def fake_get_scan(*args, **kwargs):
            return (
                {"gallery": {"a.png": {"name": "a.png", "metadata": {}}}},
                {"cache_hit": False, "files": 1},
            )

        with mock.patch.object(scan_service, "invalidate") as invalidate, \
                mock.patch.object(scan_service, "get_scan", side_effect=fake_get_scan), \
                mock.patch("server.PromptServer") as prompt_server:
            prompt_server.instance.send_sync.side_effect = lambda event, data: sent.append((event, data))
            handler.rescan_and_send_changes()

        invalidate.assert_called_once()
        self.assertEqual(os.path.realpath(invalidate.call_args[0][0]), os.path.realpath(self.root))
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "Gallery.file_change")
        self.assertIn("gallery", sent[0][1]["folders"])
        self.assertEqual(
            handler.last_known_folders, {"gallery": {"a.png": {"name": "a.png", "metadata": {}}}}
        )

    def test_start_returns_quickly_and_stop_cleans_up(self):
        monitor = folder_monitor.FileSystemMonitor(self.root)
        try:
            started_at = time.perf_counter()
            monitor.start_monitoring()
            elapsed = time.perf_counter() - started_at
            self.assertLess(elapsed, 1.0, "start_monitoring must not wait for the initial scan")
            self.assertIsNotNone(monitor.thread)
            self.assertTrue(monitor.thread.is_alive())
            deadline = time.time() + 5.0
            while not monitor.observer.is_alive() and time.time() < deadline:
                time.sleep(0.05)
            self.assertTrue(monitor.observer.is_alive())
        finally:
            monitor.stop_monitoring()
        self.assertIsNone(monitor.thread)
        self.assertFalse(monitor.observer.is_alive())

    def test_detect_folder_changes(self):
        old = {"gallery": {"a.png": {"name": "a.png"}, "b.png": {"name": "b.png"}}}
        new = {"gallery": {"b.png": {"name": "b.png", "timestamp": 2}, "c.png": {"name": "c.png"}}}
        changes = folder_monitor.detect_folder_changes(old, new)
        folder_changes = changes["folders"]["gallery"]
        self.assertEqual(folder_changes["a.png"]["action"], "remove")
        self.assertEqual(folder_changes["b.png"]["action"], "update")
        self.assertEqual(folder_changes["c.png"]["action"], "create")


if __name__ == "__main__":
    unittest.main()
