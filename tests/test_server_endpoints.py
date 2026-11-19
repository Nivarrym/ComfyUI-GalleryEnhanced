import asyncio
import importlib
import json
import os
import tempfile
import threading
import time
import unittest
from unittest import mock

from PIL import Image, PngImagePlugin

import _loader
import _comfy_stubs
import _tmp

_loader.load_package()
_PREFERENCES = _comfy_stubs.install()
server = importlib.import_module("gallery_under_test.server")
folder_scanner = _loader.load_module("folder_scanner")
scan_service = _loader.load_module("scan_service")
metadata_service = _loader.load_module("metadata_service")
thumbnail_service = _loader.load_module("thumbnail_service")
gallery_perf = _loader.load_module("gallery_perf")
gallery_config = _loader.load_module("gallery_config")

from aiohttp.test_utils import TestClient, TestServer  # noqa: E402


def _write_png(path, size=(10, 10), prompt=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    info = PngImagePlugin.PngInfo()
    if prompt is not None:
        info.add_text("prompt", json.dumps(prompt))
    with Image.new("RGB", size, (120, 60, 30)) as image:
        image.save(path, pnginfo=info)


class GalleryServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = _tmp.TempDir(prefix="gallery-server-")
        self.root = os.path.join(self.temp.name, "gallery")
        os.makedirs(os.path.join(self.root, "sub"))
        _comfy_stubs.set_output_directory(self.root)
        _comfy_stubs.set_static_dir(self.root)
        thumbnail_service.set_cache_dir(os.path.join(self.temp.name, "thumbs"))
        thumbnail_service.clear_all()
        metadata_service.invalidate_all()
        scan_service.invalidate()
        gallery_perf.reset()
        gallery_perf.configure(False)
        gallery_config.debug_perf = False
        gallery_config.disable_logs = False
        server.monitor = None
        server.SETTINGS_FILE = os.path.join(self.temp.name, "user_settings.json")

        app = _comfy_stubs.make_aiohttp_app(server)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        try:
            await self.client.close()
        except Exception:
            pass
        server.monitor = None
        thumbnail_service.clear_all()
        thumbnail_service.set_cache_dir(None)
        scan_service.invalidate()
        metadata_service.invalidate_all()
        self.temp.cleanup()

    # -- helpers ---------------------------------------------------------
    async def _request(self, method, path, **kwargs):
        return await self.client.request(method, path, **kwargs)

    # -- tests -----------------------------------------------------------
    async def test_images_listing_is_lazy_and_cached(self):
        _write_png(os.path.join(self.root, "a.png"), prompt={"1": {"class_type": "A"}})
        _write_png(os.path.join(self.root, "sub", "b.png"))
        with open(os.path.join(self.root, "clip.mp4"), "wb") as handle:
            handle.write(b"\x00" * 8)

        with mock.patch.object(
            folder_scanner, "buildMetadata", side_effect=AssertionError("opened image")
        ):
            response = await self.client.get("/Gallery/images", params={"relative_path": "./"})
            self.assertEqual(response.status, 200)
            payload = await response.json()

        self.assertIn("X-Gallery-Scan-Ms", response.headers)
        self.assertEqual(response.headers["X-Gallery-Scan-Cache"], "miss")
        self.assertEqual(response.headers["X-Gallery-File-Count"], "3")
        self.assertIn("X-Gallery-Metadata-Ms", response.headers)

        folders = payload["folders"]
        base_name = os.path.basename(self.root)
        root_files = folders[base_name]
        self.assertEqual(set(root_files), {"a.png", "clip.mp4"})
        self.assertEqual(root_files["a.png"]["metadata"], {})
        self.assertEqual(root_files["a.png"]["type"], "image")
        self.assertEqual(root_files["a.png"]["url"], "/static_gallery/a.png")
        self.assertEqual(root_files["clip.mp4"]["type"], "media")
        self.assertIn(f"{base_name}/sub", folders)
        self.assertEqual(folders[f"{base_name}/sub"]["b.png"]["url"], "/static_gallery/sub/b.png")

        second = await self.client.get("/Gallery/images", params={"relative_path": "./"})
        self.assertEqual(second.status, 200)
        self.assertEqual(second.headers["X-Gallery-Scan-Cache"], "hit")
        self.assertEqual(second.headers["X-Gallery-File-Count"], "3")

    async def test_images_does_not_block_event_loop(self):
        _write_png(os.path.join(self.root, "a.png"))

        def slow_scan(*args, **kwargs):
            time.sleep(0.6)
            return ({"gallery": {"a.png": {"name": "a.png", "metadata": {}}}}, False)

        with mock.patch.object(server.scan_service, "_scan_impl", side_effect=slow_scan):
            server.scan_service.invalidate()
            slow_request = asyncio.ensure_future(
                self.client.get("/Gallery/images", params={"relative_path": "./"})
            )
            await asyncio.sleep(0.1)
            started = time.perf_counter()
            perf_response = await self.client.get("/Gallery/perf")
            elapsed = time.perf_counter() - started
            slow_response = await slow_request

        self.assertEqual(slow_response.status, 200)
        self.assertEqual(perf_response.status, 200)
        self.assertLess(elapsed, 0.3, "event loop was blocked by the scan")

    async def test_metadata_endpoint_caches_and_invalidates(self):
        asset = os.path.join(self.root, "asset.png")
        _write_png(asset, size=(14, 6), prompt={"1": {"class_type": "SaveImage"}})

        first = await self.client.get(
            "/Gallery/metadata", params={"path": "/static_gallery/asset.png"}
        )
        self.assertEqual(first.status, 200)
        first_payload = await first.json()
        self.assertFalse(first_payload["cached"])
        self.assertEqual(first_payload["metadata"]["fileinfo"]["resolution"], "14x6")
        self.assertEqual(first_payload["metadata"]["prompt"], {"1": {"class_type": "SaveImage"}})

        second = await self.client.get(
            "/Gallery/metadata", params={"path": "/static_gallery/asset.png"}
        )
        second_payload = await second.json()
        self.assertTrue(second_payload["cached"])

        stat = os.stat(asset)
        os.utime(asset, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
        third = await self.client.get(
            "/Gallery/metadata", params={"path": "/static_gallery/asset.png"}
        )
        third_payload = await third.json()
        self.assertFalse(third_payload["cached"])

    async def test_metadata_errors(self):
        missing = await self.client.get(
            "/Gallery/metadata", params={"path": "/static_gallery/missing.png"}
        )
        self.assertEqual(missing.status, 404)

        no_path = await self.client.get("/Gallery/metadata")
        self.assertEqual(no_path.status, 400)

        bad_format = await self.client.get(
            "/Gallery/metadata", params={"path": "asset.png"}
        )
        self.assertEqual(bad_format.status, 400)

        traversal = await self.client.get(
            "/Gallery/metadata", params={"path": "/static_gallery/../secret.png"}
        )
        self.assertEqual(traversal.status, 400)

    async def test_thumbnail_endpoint_webp_and_cache(self):
        asset = os.path.join(self.root, "big.png")
        _write_png(asset, size=(640, 480))
        original_size = os.path.getsize(asset)

        response = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/big.png", "w": "200", "v": "1"}
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Content-Type"], "image/webp")
        self.assertEqual(response.headers["X-Gallery-Thumb-Cache"], "miss")
        self.assertIn("immutable", response.headers["Cache-Control"])
        data = await response.read()
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(data[8:12], b"WEBP")
        self.assertLess(len(data), original_size)

        second = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/big.png", "w": "200"}
        )
        self.assertEqual(second.headers["X-Gallery-Thumb-Cache"], "hit")
        self.assertEqual(await second.read(), data)

    async def test_thumbnail_errors(self):
        asset = os.path.join(self.root, "big.png")
        _write_png(asset, size=(100, 100))

        too_small = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/big.png", "w": "32"}
        )
        self.assertEqual(too_small.status, 400)

        no_width = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/big.png"}
        )
        self.assertEqual(no_width.status, 400)

        missing = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/nope.png", "w": "128"}
        )
        self.assertEqual(missing.status, 404)

        with open(os.path.join(self.root, "clip.mp4"), "wb") as handle:
            handle.write(b"\x00" * 8)
        unsupported = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/clip.mp4", "w": "128"}
        )
        self.assertEqual(unsupported.status, 415)

        traversal = await self.client.get(
            "/Gallery/thumbnail", params={"path": "/static_gallery/../secret.png", "w": "128"}
        )
        self.assertEqual(traversal.status, 400)

    async def test_batch_delete_mixed_valid_invalid(self):
        _write_png(os.path.join(self.root, "a.png"))
        _write_png(os.path.join(self.root, "b.png"))
        _write_png(os.path.join(self.root, "sub", "c.png"))
        outside = os.path.join(self.temp.name, "outside.txt")
        with open(outside, "w", encoding="utf-8") as handle:
            handle.write("keep me")

        # Warm the listing cache so we can verify invalidation afterwards.
        await self.client.get("/Gallery/images", params={"relative_path": "./"})

        payload = {
            "image_paths": [
                "/static_gallery/a.png",
                "/static_gallery/missing.png",
                "/static_gallery/../outside.txt",
                "/static_gallery/sub",
            ]
        }
        response = await self.client.post("/Gallery/delete", json=payload)
        self.assertEqual(response.status, 200)
        result = await response.json()
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["deleted"], ["/static_gallery/a.png"])
        self.assertEqual(len(result["failed"]), 3)
        failed_paths = {entry["path"] for entry in result["failed"]}
        self.assertEqual(
            failed_paths,
            {
                "/static_gallery/missing.png",
                "/static_gallery/../outside.txt",
                "/static_gallery/sub",
            },
        )
        self.assertFalse(os.path.exists(os.path.join(self.root, "a.png")))
        self.assertTrue(os.path.exists(outside))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "sub")))

        # Legacy single-path format still works and returns the new JSON shape.
        legacy = await self.client.post(
            "/Gallery/delete", json={"image_path": "/static_gallery/b.png"}
        )
        self.assertEqual(legacy.status, 200)
        legacy_result = await legacy.json()
        self.assertEqual(legacy_result["count"], 1)
        self.assertEqual(legacy_result["deleted"], ["/static_gallery/b.png"])
        self.assertFalse(os.path.exists(os.path.join(self.root, "b.png")))

        # Delete must have invalidated the listing cache.
        after = await self.client.get("/Gallery/images", params={"relative_path": "./"})
        self.assertEqual(after.headers["X-Gallery-Scan-Cache"], "miss")
        after_payload = await after.json()
        base_name = os.path.basename(self.root)
        self.assertNotIn("a.png", after_payload["folders"].get(base_name, {}))
        self.assertNotIn("b.png", after_payload["folders"].get(base_name, {}))
        self.assertIn("c.png", after_payload["folders"][f"{base_name}/sub"])

    async def test_delete_rejects_invalid_payload(self):
        response = await self.client.post("/Gallery/delete", json={})
        self.assertEqual(response.status, 400)
        payload = await response.json()
        self.assertIn("error", payload)

        response = await self.client.post(
            "/Gallery/delete", json={"image_paths": "/static_gallery/a.png"}
        )
        self.assertEqual(response.status, 400)

    async def test_move_invalidates_and_moves(self):
        _write_png(os.path.join(self.root, "move-me.png"))
        response = await self.client.post(
            "/Gallery/move",
            json={
                "source_path": "/static_gallery/move-me.png",
                "target_path": "/static_gallery/sub/moved.png",
            },
        )
        self.assertEqual(response.status, 200)
        self.assertFalse(os.path.exists(os.path.join(self.root, "move-me.png")))
        self.assertTrue(os.path.exists(os.path.join(self.root, "sub", "moved.png")))

        blocked = await self.client.post(
            "/Gallery/move",
            json={
                "source_path": "/static_gallery/sub/moved.png",
                "target_path": "/static_gallery/../escaped.png",
            },
        )
        self.assertEqual(blocked.status, 400)
        self.assertTrue(os.path.exists(os.path.join(self.root, "sub", "moved.png")))

    async def test_perf_endpoints(self):
        _write_png(os.path.join(self.root, "a.png"))
        await self.client.get("/Gallery/images", params={"relative_path": "./"})
        response = await self.client.get("/Gallery/perf")
        self.assertEqual(response.status, 200)
        payload = await response.json()
        self.assertIn("records", payload)
        self.assertIn("scan", payload)
        self.assertIn("thumbnails", payload)
        self.assertGreaterEqual(payload["scan"]["count"], 1)
        self.assertIn("scan", {record["label"] for record in payload["records"]})

        reset = await self.client.delete("/Gallery/perf")
        self.assertEqual(reset.status, 200)
        after = await (await self.client.get("/Gallery/perf")).json()
        self.assertEqual(after["records"], [])
        self.assertEqual(after["scan"]["count"], 0)

    async def test_monitor_start_returns_immediately_and_invalidates_cache(self):
        _write_png(os.path.join(self.root, "a.png"))
        await self.client.get("/Gallery/images", params={"relative_path": "./"})
        self.assertGreater(scan_service.cache_size(), 0)

        started_instances = []

        class FakeMonitor:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                self.thread = None
                started_instances.append(self)

            def start_monitoring(self):
                self.started = True

        with mock.patch.object(server, "FileSystemMonitor", FakeMonitor):
            measure_start = time.perf_counter()
            response = await self.client.post(
                "/Gallery/monitor/start", json={"relative_path": "./"}
            )
            elapsed = time.perf_counter() - measure_start

        self.assertEqual(response.status, 200)
        self.assertLess(elapsed, 1.0)
        self.assertEqual(len(started_instances), 1)
        self.assertTrue(getattr(started_instances[0], "started", False))
        self.assertEqual(scan_service.cache_size(), 0)
        self.assertEqual(_comfy_stubs.get_static_dir(), os.path.realpath(self.root))

        await self.client.post("/Gallery/monitor/stop")

    async def test_monitor_start_shares_inflight_scan(self):
        _write_png(os.path.join(self.root, "a.png"))
        calls = []
        scan_started = threading.Event()
        scan_finished = threading.Event()
        monitor_threads = []

        def slow_scan(*args, **kwargs):
            calls.append(1)
            scan_started.set()
            time.sleep(0.35)
            scan_finished.set()
            return ({"gallery": {"a.png": {"name": "a.png", "metadata": {}}}}, False)

        scan_extensions = list(folder_scanner.DEFAULT_EXTENSIONS)

        class FakeMonitor:
            def __init__(self, base_path, interval=1.0, use_polling_observer=False,
                         extensions=None, deduplicate_symlinks=True):
                self.base_path = base_path
                self.extensions = extensions
                self.thread = None

            def start_monitoring(self):
                def run_initial_scan():
                    scan_service.get_scan(
                        self.base_path,
                        os.path.basename(self.base_path),
                        self.extensions,
                        True,
                        False,
                    )

                thread = threading.Thread(target=run_initial_scan, daemon=True)
                monitor_threads.append(thread)
                thread.start()

        with mock.patch.object(scan_service, "_scan_impl", side_effect=slow_scan), \
                mock.patch.object(server, "FileSystemMonitor", FakeMonitor):
            scan_service.invalidate()
            images_task = asyncio.ensure_future(
                self.client.get("/Gallery/images", params={"relative_path": "./"})
            )
            for _ in range(200):
                if scan_started.is_set():
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(scan_started.is_set(), "images scan did not start")

            response = await self.client.post(
                "/Gallery/monitor/start",
                json={"relative_path": "./", "scan_extensions": scan_extensions},
            )
            self.assertEqual(response.status, 200)
            images_response = await images_task
            self.assertEqual(images_response.status, 200)

            for _ in range(200):
                if scan_finished.is_set():
                    break
                await asyncio.sleep(0.01)
            for thread in monitor_threads:
                thread.join(timeout=5)

        self.assertEqual(calls, [1], "monitor start must share the in-flight scan")
        await self.client.post("/Gallery/monitor/stop")

    async def test_settings_persist_and_toggle_perf(self):
        response = await self.client.post(
            "/Gallery/settings", json={"debugPerf": True, "disableLogs": True}
        )
        self.assertEqual(response.status, 200)
        self.assertTrue(gallery_config.debug_perf)
        with open(server.SETTINGS_FILE, "r", encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["debugPerf"], True)

        loaded = await (await self.client.get("/Gallery/settings")).json()
        self.assertTrue(loaded["debugPerf"])
        gallery_config.disable_logs = False


if __name__ == "__main__":
    unittest.main()
