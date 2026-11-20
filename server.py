from server import PromptServer
from aiohttp import web
import os
import tempfile
import json
import math
import pathlib
import threading
import asyncio
import shutil
import subprocess
import sys

import folder_paths

from .folder_monitor import FileSystemMonitor
from .folder_scanner import DEFAULT_EXTENSIONS
from .gallery_config import gallery_log
from . import gallery_config
from . import gallery_paths
from . import gallery_perf
from . import metadata_service
from . import scan_service
from . import thumbnail_service

# Add ComfyUI root to sys.path HERE
comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(comfy_path)

monitor = None
# Placeholder directory.  This *must* exist, even if it's empty.
PLACEHOLDER_DIR = os.path.join(comfy_path, "output")  # os.path.abspath("./placeholder_static")
try:
    os.makedirs(PLACEHOLDER_DIR, exist_ok=True)
except OSError:
    # Read-only installs / unit test environments: fall back to a temp dir.
    PLACEHOLDER_DIR = os.path.join(tempfile.gettempdir(), "comfyui-gallery-placeholder")
    os.makedirs(PLACEHOLDER_DIR, exist_ok=True)

# Add a *placeholder* static route.  This gets modified later.
PromptServer.instance.routes.static('/static_gallery', PLACEHOLDER_DIR, follow_symlinks=True, name='static_gallery_placeholder')  # give a name to the route

# Initialize scan_lock here (kept for compatibility with anything that used it)
PromptServer.instance.scan_lock = threading.Lock()

# Settings file for persistent user settings
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_settings.json")


def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            gallery_log(f"Error loading settings: {e}")
            return {}
    return {}


def save_settings_to_file(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=4)
    except Exception as e:
        gallery_log(f"Error saving settings: {e}")


def sanitize_json_data(data):
    """Recursively sanitizes data to be JSON serializable."""
    if isinstance(data, dict):
        return {k: sanitize_json_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_json_data(item) for item in data]
    elif isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    elif isinstance(data, (int, str, bool, type(None))):
        return data
    else:
        return str(data)


# ---------------------------------------------------------------------------
# Path / settings helpers
# ---------------------------------------------------------------------------

def _find_static_route():
    try:
        for route in PromptServer.instance.app.router.routes():
            if getattr(route, 'name', None) == 'static_gallery_placeholder':
                return route
    except Exception:
        pass
    return None


def get_static_root():
    """Real filesystem root currently served at /static_gallery."""
    route = _find_static_route()
    if route is not None:
        try:
            return os.path.realpath(str(route.resource._directory))
        except Exception:
            pass
    return os.path.realpath(folder_paths.get_output_directory())


def _resolve_images_root(relative_path):
    """Backward-compatible /Gallery/images path resolution (always did this)."""
    base_output_dir = folder_paths.get_output_directory()
    if os.path.isabs(relative_path):
        return os.path.normpath(relative_path)
    if relative_path in ("./", ".", ""):
        return base_output_dir
    return os.path.normpath(os.path.join(base_output_dir, relative_path))


def _info_headers(info):
    return {
        "X-Gallery-Scan-Ms": f"{float(info.get('duration_ms', 0.0)):.2f}",
        "X-Gallery-Scan-Cache": "hit" if info.get("cache_hit") else "miss",
        "X-Gallery-File-Count": str(int(info.get("files", 0))),
        "X-Gallery-Metadata-Ms": f"{float(info.get('metadata_ms', 0.0)):.2f}",
    }


def _apply_perf_setting(settings):
    enabled = bool(settings.get("debug_perf", settings.get("debugPerf", False)))
    gallery_config.debug_perf = enabled
    gallery_perf.configure(enabled)


def _switch_static_route(directory):
    route = _find_static_route()
    if route is None:
        return False
    route.resource._directory = pathlib.Path(directory)
    gallery_log(f"Serving static files from {directory} at /static_gallery")
    return True


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/Gallery/settings")
async def get_settings(request):
    return web.json_response(load_settings())


@PromptServer.instance.routes.post("/Gallery/settings")
async def save_settings(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            return web.Response(status=400, text="Invalid settings payload")
        save_settings_to_file(data)
        gallery_config.disable_logs = bool(data.get("disableLogs", gallery_config.disable_logs))
        _apply_perf_setting(data)
        # Extension / symlink settings may have changed: do not serve a stale scan.
        scan_service.invalidate()
        return web.Response(text="Settings saved")
    except Exception as e:
        return web.Response(status=500, text=str(e))


# ---------------------------------------------------------------------------
# Fast listing (no metadata, off the event loop)
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/Gallery/images")
async def get_gallery_images(request):
    """Lightweight listing: directory walk + stat only, metadata lazy via /Gallery/metadata."""
    raw_rel = request.rel_url.query.get("relative_path", "./")
    if raw_rel is None or str(raw_rel).lower() == 'null' or str(raw_rel).strip() == "":
        relative_path = "./"
    else:
        relative_path = raw_rel

    full_monitor_path = _resolve_images_root(relative_path)
    force_refresh = request.rel_url.query.get("refresh") == "1"
    if force_refresh:
        # Opening the gallery asks for a fresh listing, even if the short TTL
        # cache still holds the pre-generation scan.
        scan_service.invalidate(None)

    saved = load_settings()
    scan_extensions = saved.get('scanExtensions') or DEFAULT_EXTENSIONS
    deduplicate_symlinks = saved.get('deduplicateSymlinks', True)
    folder_name = os.path.basename(os.path.normpath(full_monitor_path))
    if not folder_name:
        folder_name = os.path.basename(os.path.normpath(folder_paths.get_output_directory())) or "output"

    try:
        # asyncio.to_thread keeps the aiohttp event loop responsive even when a
        # large tree takes seconds to scan.
        folders_with_metadata, info = await asyncio.to_thread(
            scan_service.get_scan,
            full_monitor_path,
            folder_name,
            scan_extensions,
            deduplicate_symlinks,
            False,
        )
    except Exception as e:
        gallery_log(f"Error in /Gallery/images: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))

    try:
        sanitized_folders = sanitize_json_data(folders_with_metadata)
    except Exception as e:
        gallery_log(f"Error sanitizing /Gallery/images response: {e}")
        return web.Response(status=500, text=str(e))

    return web.json_response({"folders": sanitized_folders}, headers=_info_headers(info))


# ---------------------------------------------------------------------------
# Lazy per-asset metadata
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/Gallery/metadata")
async def get_asset_metadata(request):
    raw_path = request.query.get("path")
    if not raw_path:
        return web.Response(status=400, text="path is required")

    try:
        resolved = gallery_paths.resolve_gallery_path(get_static_root(), raw_path)
    except gallery_paths.GalleryPathError as e:
        return web.Response(status=e.status, text=str(e))

    if not os.path.isfile(resolved.path):
        return web.Response(status=404, text="File not found")

    try:
        metadata, cached = await asyncio.to_thread(metadata_service.get_metadata, resolved.path)
    except FileNotFoundError:
        return web.Response(status=404, text="File not found")
    except OSError as e:
        # Pillow UnidentifiedImageError / truncated files are OSError subclasses.
        return web.Response(status=415, text=f"Unsupported image: {e}")
    except Exception as e:
        gallery_log(f"Error extracting metadata for {raw_path}: {e}")
        return web.Response(status=500, text=str(e))

    return web.json_response(
        {"metadata": sanitize_json_data(metadata), "cached": bool(cached)}
    )


# ---------------------------------------------------------------------------
# Cached WebP thumbnails
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/Gallery/thumbnail")
async def get_asset_thumbnail(request):
    raw_path = request.query.get("path")
    if not raw_path:
        return web.Response(status=400, text="path is required")

    width = request.query.get("w")
    if width is None:
        return web.Response(status=400, text="w is required")

    try:
        resolved = gallery_paths.resolve_gallery_path(get_static_root(), raw_path)
    except gallery_paths.GalleryPathError as e:
        return web.Response(status=e.status, text=str(e))

    if not os.path.exists(resolved.path):
        return web.Response(status=404, text="File not found")
    if not os.path.isfile(resolved.path):
        return web.Response(status=400, text="Path is not a file")

    try:
        data, content_type, cache_hit = await asyncio.to_thread(
            thumbnail_service.get_thumbnail, resolved.path, width
        )
    except thumbnail_service.ThumbnailError as e:
        return web.Response(status=e.status, text=str(e))
    except Exception as e:
        gallery_log(f"Error generating thumbnail for {raw_path}: {e}")
        return web.Response(status=500, text=str(e))

    return web.Response(
        body=data,
        content_type=content_type,
        headers={
            "X-Gallery-Thumb-Cache": "hit" if cache_hit else "miss",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


# ---------------------------------------------------------------------------
# Monitor lifecycle
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.post("/Gallery/monitor/start")
async def start_gallery_monitor(request):
    """Start monitoring; returns immediately (initial scan runs in background)."""
    global monitor
    try:
        try:
            data = await request.json()
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}

        relative_path = data.get("relative_path", "./")
        if relative_path is None or str(relative_path).lower() == 'null' or str(relative_path).strip() == "":
            relative_path = "./"

        gallery_config.disable_logs = bool(data.get("disable_logs", False))
        gallery_config.use_polling_observer = bool(data.get("use_polling_observer", False))
        if "debug_perf" in data or "debugPerf" in data:
            _apply_perf_setting(data)
        else:
            _apply_perf_setting(load_settings())
        scan_extensions = data.get("scan_extensions") or DEFAULT_EXTENSIONS
        deduplicate_symlinks = bool(data.get("deduplicate_symlinks", True))

        full_monitor_path = _resolve_images_root(relative_path)
        gallery_log("disable_logs", gallery_config.disable_logs)
        gallery_log("use_polling_observer", gallery_config.use_polling_observer)

        if not os.path.isdir(full_monitor_path):
            return web.Response(status=400, text=f"Invalid relative_path: {relative_path}, path not found")

        if monitor and monitor.thread and monitor.thread.is_alive():
            gallery_log("FileSystemMonitor: Monitor already running, stopping previous monitor.")
            # Joining the observer/scan thread can take a moment; keep the event
            # loop free for the rest of ComfyUI while it shuts down.
            await asyncio.to_thread(monitor.stop_monitoring)

        if not _switch_static_route(full_monitor_path):
            gallery_log("Error: Placeholder static route not found!")
            return web.Response(status=500, text="Placeholder route not found.")

        # Stale listing from a previous root/settings must not be reused, but a
        # scan that is already running (e.g. concurrent /Gallery/images) is kept
        # joinable so startup performs one real scan instead of two.
        scan_service.invalidate(None, drop_inflight=False)

        monitor = FileSystemMonitor(
            full_monitor_path,
            interval=1.0,
            use_polling_observer=gallery_config.use_polling_observer,
            extensions=scan_extensions,
            deduplicate_symlinks=deduplicate_symlinks,
        )
        monitor.start_monitoring()
        return web.Response(text="Gallery monitor started", content_type="text/plain")
    except Exception as e:
        gallery_log(f"Error starting gallery monitor: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/Gallery/monitor/stop")
async def stop_gallery_monitor(request):
    """Endpoint to stop gallery monitoring."""
    global monitor
    if monitor and monitor.thread and monitor.thread.is_alive():
        await asyncio.to_thread(monitor.stop_monitoring)
        monitor = None
    _switch_static_route(PLACEHOLDER_DIR)
    return web.Response(text="Gallery monitor stopped", content_type="text/plain")


@PromptServer.instance.routes.patch("/Gallery/updateImages")
async def newSettings(request):
    # This route is no longer used
    return web.Response(status=200)


# ---------------------------------------------------------------------------
# Delete (batch + legacy single path)
# ---------------------------------------------------------------------------

def _collect_delete_paths(data):
    if not isinstance(data, dict):
        raise gallery_paths.GalleryPathError("Invalid JSON payload", 400)
    if "image_paths" in data:
        raw_paths = data.get("image_paths")
        if not isinstance(raw_paths, list):
            raise gallery_paths.GalleryPathError("image_paths must be a list", 400)
        return raw_paths
    if data.get("image_path"):
        return [data.get("image_path")]
    raise gallery_paths.GalleryPathError("image_path or image_paths is required", 400)


@PromptServer.instance.routes.post("/Gallery/delete")
async def delete_image(request):
    """Delete one or many assets; always validates realpath containment."""
    try:
        data = await request.json()
        raw_paths = _collect_delete_paths(data)
    except gallery_paths.GalleryPathError as e:
        return web.json_response({"error": str(e)}, status=e.status)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

    if len(raw_paths) > 5000:
        return web.json_response({"error": "Too many paths in one request"}, status=400)

    static_root = get_static_root()
    deleted = []
    failed = []

    for raw_path in raw_paths:
        try:
            if not isinstance(raw_path, str) or not raw_path.strip():
                raise gallery_paths.GalleryPathError("Invalid path", 400)
            resolved = gallery_paths.resolve_gallery_path(static_root, raw_path)
            if os.path.isdir(resolved.path):
                raise gallery_paths.GalleryPathError("Refusing to delete a directory", 400)
            if not os.path.isfile(resolved.path):
                raise gallery_paths.GalleryPathError("File not found", 404)
            os.remove(resolved.path)
        except gallery_paths.GalleryPathError as e:
            failed.append({"path": raw_path if isinstance(raw_path, str) else str(raw_path), "error": str(e)})
            continue
        except OSError as e:
            failed.append({"path": raw_path if isinstance(raw_path, str) else str(raw_path), "error": str(e)})
            continue

        deleted.append(raw_path)
        try:
            metadata_service.invalidate(resolved.path)
            thumbnail_service.invalidate(resolved.path)
        except Exception as e:
            gallery_log(f"Error invalidating caches for {raw_path}: {e}")

    if deleted:
        # Deleted asset may live under a subfolder that was itself a scan root.
        scan_service.invalidate()

    gallery_log(f"/Gallery/delete: deleted={len(deleted)} failed={len(failed)}")
    return web.json_response(
        {"deleted": deleted, "failed": failed, "count": len(deleted)}
    )


# ---------------------------------------------------------------------------
# Move (legacy API, cache-aware)
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.post("/Gallery/move")
async def move_image(request):
    """Move an image within the gallery root, invalidating all caches."""
    try:
        data = await request.json()
        source_path = data.get("source_path")
        target_path = data.get("target_path")
        current_path = data.get("current_path") or data.get("relative_path") or "./"
        gallery_log(f"source_path: {source_path}")
        gallery_log(f"target_path: {target_path}")
        gallery_log(f"current_path: {current_path}")
        if not source_path or not target_path:
            return web.Response(status=400, text="source_path and target_path are required")

        static_dir = get_static_root()
        try:
            source = gallery_paths.resolve_local_path(static_dir, source_path)
            target = gallery_paths.resolve_local_path(static_dir, target_path)
        except gallery_paths.GalleryPathError as e:
            return web.Response(status=e.status, text=str(e))

        if not os.path.isfile(source.path):
            return web.Response(status=404, text=f"Source file not found: {source_path}")

        if os.path.isdir(target.path):
            full_target_path = os.path.join(target.path, os.path.basename(source.path))
            if not gallery_paths.is_within_root(full_target_path, static_dir):
                return web.Response(status=403, text="Access denied: target outside of gallery root")
        else:
            full_target_path = target.path

        target_dir = os.path.dirname(full_target_path)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)

        shutil.move(source.path, full_target_path)

        # Invalidate scan + per-asset metadata/thumbnail caches for both paths.
        scan_service.invalidate()
        metadata_service.invalidate(source.path)
        metadata_service.invalidate(full_target_path)
        thumbnail_service.invalidate(source.path)
        thumbnail_service.invalidate(full_target_path)
        return web.Response(text=f"Image moved from {source_path} to {target_path}")
    except Exception as e:
        gallery_log(f"Error moving image: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))


# ---------------------------------------------------------------------------
# External file actions (file manager / default application)
# ---------------------------------------------------------------------------

def _reveal_in_file_manager(path):
    """Select/focus *path* in the host's file manager (best effort)."""
    if os.name == "nt":
        # Explorer accepts /select, followed by the path as the next argument.
        subprocess.Popen(["explorer.exe", "/select,", path], close_fds=True)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path) or path])


def _open_with_default_app(path):
    """Open *path* with the host's default associated application."""
    if os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def _resolve_action_asset(raw_path):
    if not raw_path:
        raise gallery_paths.GalleryPathError("image_path is required", 400)
    resolved = gallery_paths.resolve_gallery_path(get_static_root(), raw_path)
    if not os.path.isfile(resolved.path):
        raise gallery_paths.GalleryPathError("File not found", 404)
    return resolved


@PromptServer.instance.routes.post("/Gallery/reveal")
async def reveal_asset(request):
    try:
        data = await request.json()
        resolved = _resolve_action_asset(data.get("image_path") if isinstance(data, dict) else None)
        await asyncio.to_thread(_reveal_in_file_manager, resolved.path)
        return web.json_response({"ok": True})
    except gallery_paths.GalleryPathError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=e.status)
    except Exception as e:
        gallery_log(f"Error revealing asset: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/Gallery/open")
async def open_asset_external(request):
    try:
        data = await request.json()
        resolved = _resolve_action_asset(data.get("image_path") if isinstance(data, dict) else None)
        await asyncio.to_thread(_open_with_default_app, resolved.path)
        return web.json_response({"ok": True})
    except gallery_paths.GalleryPathError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=e.status)
    except Exception as e:
        gallery_log(f"Error opening asset: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


# ---------------------------------------------------------------------------
# Performance records
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/Gallery/perf")
async def get_gallery_perf(request):
    return web.json_response(gallery_perf.snapshot())


@PromptServer.instance.routes.delete("/Gallery/perf")
async def reset_gallery_perf(request):
    gallery_perf.reset()
    return web.json_response({"ok": True})
