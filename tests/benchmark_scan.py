"""Temp-directory benchmark for the gallery scan path.

Run from the repo root with the ComfyUI 0.45 interpreter:

    python tests/benchmark_scan.py [file_count]

It generates ``file_count`` tiny files, then measures:
  * a cold ``scan_service.get_scan`` (real directory walk),
  * a warm call (TTL cache hit),
  * the same cold/warm pair through the real ``/Gallery/images`` aiohttp handler
    (including JSON serialization and response headers).
"""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
import tempfile
import time

import _loader
import _comfy_stubs
import _tmp

_loader.load_package()
_comfy_stubs.install()

from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

server = importlib.import_module("gallery_under_test.server")
scan_service = _loader.load_module("scan_service")

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x00\x03\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82"
)


def make_files(root: str, count: int) -> None:
    folders = 10
    for index in range(count):
        folder = os.path.join(root, f"batch-{index % folders:02d}")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"image-{index:05d}.png"), "wb") as handle:
            handle.write(PNG_BYTES)


def bench_service(root: str) -> None:
    scan_service.invalidate()
    started = time.perf_counter()
    _folders, cold = scan_service.get_scan(root, os.path.basename(root), [".png"], True, False)
    cold_ms = (time.perf_counter() - started) * 1000.0

    started = time.perf_counter()
    _folders, warm = scan_service.get_scan(root, os.path.basename(root), [".png"], True, False)
    warm_ms = (time.perf_counter() - started) * 1000.0

    print("scan_service.get_scan:")
    print(f"  cold : {cold_ms:9.2f} ms  (scan_ms={cold['scan_ms']:.2f}, files={cold['files']})")
    print(f"  warm : {warm_ms:9.2f} ms  (cache_hit={warm['cache_hit']}, age={warm['cache_age_ms']:.2f} ms)")
    if warm_ms > 0:
        print(f"  speedup: {cold_ms / warm_ms:.1f}x")


async def bench_http(root: str) -> None:
    _comfy_stubs.set_output_directory(root)
    _comfy_stubs.set_static_dir(root)
    server.SETTINGS_FILE = os.path.join(root, "..", "bench_user_settings.json")
    scan_service.invalidate()

    app = _comfy_stubs.make_aiohttp_app(server)
    async with TestClient(TestServer(app)) as client:
        started = time.perf_counter()
        cold_response = await client.get("/Gallery/images", params={"relative_path": "./"})
        cold_ms = (time.perf_counter() - started) * 1000.0
        cold_payload = await cold_response.json()

        started = time.perf_counter()
        warm_response = await client.get("/Gallery/images", params={"relative_path": "./"})
        warm_ms = (time.perf_counter() - started) * 1000.0
        warm_payload = await warm_response.json()

    file_count = sum(len(files) for files in cold_payload["folders"].values())
    print("GET /Gallery/images (end-to-end, aiohttp TestServer):")
    print(f"  cold : {cold_ms:9.2f} ms  headers(t={cold_response.headers.get('X-Gallery-Scan-Ms')} ms,"
          f" cache={cold_response.headers.get('X-Gallery-Scan-Cache')},"
          f" files={cold_response.headers.get('X-Gallery-File-Count')})")
    print(f"  warm : {warm_ms:9.2f} ms  headers(t={warm_response.headers.get('X-Gallery-Scan-Ms')} ms,"
          f" cache={warm_response.headers.get('X-Gallery-Scan-Cache')},"
          f" files={warm_response.headers.get('X-Gallery-File-Count')})")
    print(f"  files in payload: {file_count} / {sum(len(files) for files in warm_payload['folders'].values())}")
    if warm_ms > 0:
        print(f"  speedup: {cold_ms / warm_ms:.1f}x")


def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    with _tmp.TempDir(prefix="gallery-bench-") as temp_dir:
        root = os.path.join(temp_dir.name, "output")
        os.makedirs(root, exist_ok=True)
        print(f"Generating {count} files in {root} ...")
        make_files(root, count)
        bench_service(root)
        print()
        asyncio.run(bench_http(root))


if __name__ == "__main__":
    main()
