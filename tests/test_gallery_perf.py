import threading
import time
import unittest

from _loader import load_module

gallery_perf = load_module("gallery_perf")
gallery_config = load_module("gallery_config")


class PerfTest(unittest.TestCase):
    def setUp(self):
        gallery_perf.reset()
        gallery_perf.configure(False)

    def tearDown(self):
        gallery_perf.reset()
        gallery_perf.configure(False)

    def test_timer_records_ms_and_fields(self):
        with gallery_perf.timer("scan", cache="miss") as extra:
            time.sleep(0.01)
            extra["files"] = 3
        records = gallery_perf.get_records()
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["label"], "scan")
        self.assertEqual(record["cache"], "miss")
        self.assertEqual(record["files"], 3)
        self.assertGreaterEqual(record["ms"], 5.0)

    def test_ring_buffer_is_bounded(self):
        for index in range(250):
            gallery_perf.record("phase", 0.1, index=index)
        records = gallery_perf.get_records()
        self.assertEqual(len(records), gallery_perf.MAX_RECORDS)
        self.assertEqual(records[-1]["index"], 249)

    def test_reset_clears_records_and_stats(self):
        gallery_perf.record("phase", 1.0)
        gallery_perf.note_scan(False, 10.0, files=2)
        gallery_perf.reset()
        self.assertEqual(gallery_perf.get_records(), [])
        snapshot = gallery_perf.snapshot()
        self.assertEqual(snapshot["scan"]["count"], 0)
        self.assertEqual(snapshot["thumbnails"]["count"], 0)

    def test_scan_and_thumbnail_stats(self):
        gallery_perf.note_scan(False, 12.0, files=10, metadata_ms=2.0)
        gallery_perf.note_scan(True, 0.2, files=10)
        gallery_perf.note_thumbnail(False, 30.0, width=256, size=4096)
        gallery_perf.note_thumbnail(True, 0.1, width=256, size=4096)

        snapshot = gallery_perf.snapshot()
        self.assertEqual(snapshot["scan"]["count"], 2)
        self.assertEqual(snapshot["scan"]["hits"], 1)
        self.assertEqual(snapshot["scan"]["misses"], 1)
        self.assertEqual(snapshot["scan"]["files"], 10)
        self.assertEqual(snapshot["scan"]["metadata_ms"], 0.0)
        self.assertAlmostEqual(snapshot["scan"]["avg_ms"], 6.1, places=2)

        self.assertEqual(snapshot["thumbnails"]["count"], 2)
        self.assertEqual(snapshot["thumbnails"]["hits"], 1)
        self.assertEqual(snapshot["thumbnails"]["misses"], 1)
        self.assertEqual(snapshot["thumbnails"]["width"], 256)
        self.assertEqual(snapshot["thumbnails"]["bytes"], 4096)

    def test_thread_safety(self):
        errors = []

        def worker():
            try:
                for _ in range(50):
                    with gallery_perf.timer("threaded"):
                        pass
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertEqual(errors, [])
        self.assertEqual(len(gallery_perf.get_records()), gallery_perf.MAX_RECORDS)

    def test_configure_toggles_debug_flag(self):
        gallery_perf.configure(True)
        self.assertTrue(gallery_perf.is_enabled())
        self.assertTrue(gallery_config.debug_perf)
        gallery_perf.configure(False)
        self.assertFalse(gallery_config.debug_perf)


if __name__ == "__main__":
    unittest.main()
