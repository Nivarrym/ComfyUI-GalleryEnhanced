"""Single-flight + TTL cache around the gallery directory scan.

The scan itself lives in :mod:`folder_scanner`; this module guarantees that
concurrent callers (startup web request, monitor initial scan, rescan requests)
share a single real scan instead of walking the tree once per caller.

Importing this module must not require ComfyUI's ``server`` or
``folder_paths``; those are not referenced here at all.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple

from . import gallery_perf

DEFAULT_TTL = 2.0
_MAX_CACHE_ENTRIES = 64


class _Flight:
    """One in-progress scan shared by concurrent callers."""

    __slots__ = ("done", "folders", "info", "error")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.folders: Dict[str, Any] = {}
        self.info: Dict[str, Any] = {}
        self.error: Optional[BaseException] = None


@dataclass
class _CacheEntry:
    folders: Dict[str, Any]
    info: Dict[str, Any]
    created_at: float
    expires_at: float


_lock = threading.Lock()
_cache: Dict[Tuple[Any, ...], _CacheEntry] = {}
_inflight: Dict[Tuple[Any, ...], _Flight] = {}
_global_generation = 0
_root_generations: Dict[str, int] = {}


def _normalize_extensions(extensions: Optional[Sequence[str]]) -> Tuple[str, ...]:
    if extensions is None:
        from .folder_scanner import DEFAULT_EXTENSIONS

        extensions = DEFAULT_EXTENSIONS
    normalized = []
    for extension in extensions:
        if not extension:
            continue
        extension = str(extension).lower()
        if not extension.startswith("."):
            extension = "." + extension
        normalized.append(extension)
    # Sorted + de-duplicated so the cache key is stable regardless of input order.
    return tuple(sorted(set(normalized)))


def _generation(root_norm: str) -> Tuple[int, int]:
    return (_global_generation, _root_generations.get(root_norm, 0))


def _prune_locked(now: float) -> None:
    expired = [key for key, entry in _cache.items() if entry.expires_at <= now]
    for key in expired:
        _cache.pop(key, None)
    if len(_cache) > _MAX_CACHE_ENTRIES:
        ordered = sorted(_cache.items(), key=lambda item: item[1].created_at)
        for key, _entry in ordered[: len(_cache) - _MAX_CACHE_ENTRIES]:
            _cache.pop(key, None)


def _count_files(folders: Dict[str, Any]) -> int:
    try:
        return sum(len(files) for files in folders.values())
    except Exception:
        return 0


def _scan_impl(*args: Any, **kwargs: Any) -> Tuple[Dict[str, Any], bool]:
    """Indirection so tests can patch a single seam instead of Pillow/folder_scanner."""
    from .folder_scanner import _scan_for_images

    return _scan_for_images(*args, **kwargs)


def get_scan(
    root: str,
    base_name: Optional[str] = None,
    extensions: Optional[Sequence[str]] = None,
    deduplicate_symlinks: bool = True,
    extract_metadata: bool = False,
    ttl: float = DEFAULT_TTL,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return ``(folders, info)`` for *root*.

    ``info`` keys: ``cache_hit``, ``duration_ms`` (this call), ``scan_ms`` (the
    real scan, also for callers that joined it), ``files``, ``metadata_ms``,
    ``cache_age_ms``, ``joined_inflight``, ``root`` and ``base_name``.
    """

    call_started = time.perf_counter()
    try:
        real_root = os.path.realpath(root)
    except (OSError, ValueError):
        real_root = os.path.abspath(root)
    root_norm = os.path.normcase(real_root)
    if base_name is None:
        base_name = os.path.basename(os.path.normpath(real_root))

    normalized_extensions = _normalize_extensions(extensions)
    dedup = bool(deduplicate_symlinks)
    with_metadata = bool(extract_metadata)

    now = time.monotonic()
    with _lock:
        _prune_locked(now)
        generation = _generation(root_norm)
        key = (
            root_norm,
            base_name,
            normalized_extensions,
            dedup,
            with_metadata,
            generation,
        )
        cached = _cache.get(key)
        if cached is not None and cached.expires_at > now:
            info = dict(cached.info)
            info.update(
                cache_hit=True,
                joined_inflight=False,
                duration_ms=round((time.perf_counter() - call_started) * 1000.0, 3),
                cache_age_ms=round((now - cached.created_at) * 1000.0, 3),
            )
            folders = cached.folders
            gallery_perf.note_scan(
                True, info["duration_ms"], info.get("files", 0), info.get("metadata_ms", 0.0)
            )
            return folders, info

        flight = _inflight.get(key)
        leader = flight is None
        if leader:
            flight = _Flight()
            _inflight[key] = flight

    if not leader:
        # Another caller is already scanning: share its result, do not scan again.
        flight.done.wait()
        if flight.error is not None:
            raise flight.error
        info = dict(flight.info)
        info.update(
            cache_hit=True,
            joined_inflight=True,
            duration_ms=round((time.perf_counter() - call_started) * 1000.0, 3),
            cache_age_ms=0.0,
        )
        gallery_perf.note_scan(
            True, info["duration_ms"], info.get("files", 0), info.get("metadata_ms", 0.0)
        )
        return flight.folders, info

    timing: Dict[str, Any] = {"metadata_ms": 0.0}
    scan_started = time.perf_counter()
    try:
        file_count = 0
        with gallery_perf.timer("scan", cache="miss", root=base_name) as extra:
            folders, _changed = _scan_impl(
                real_root,
                base_name,
                True,
                normalized_extensions,
                dedup,
                extract_metadata=with_metadata,
                timing=timing,
            )
            file_count = _count_files(folders)
            extra["files"] = file_count
        scan_ms = (time.perf_counter() - scan_started) * 1000.0
        files = file_count
        info = {
            "cache_hit": False,
            "duration_ms": round((time.perf_counter() - call_started) * 1000.0, 3),
            "scan_ms": round(scan_ms, 3),
            "files": files,
            "metadata_ms": round(float(timing.get("metadata_ms", 0.0)), 3),
            "cache_age_ms": 0.0,
            "joined_inflight": False,
            "root": real_root,
            "base_name": base_name,
        }

        with _lock:
            # Do not repopulate the cache with data that was invalidated while
            # the scan was running.
            if _generation(root_norm) == generation:
                _cache[key] = _CacheEntry(
                    folders=folders,
                    info=dict(info),
                    created_at=time.monotonic(),
                    expires_at=time.monotonic() + max(float(ttl), 0.0),
                )
            _inflight.pop(key, None)

        flight.folders = folders
        flight.info = info
        gallery_perf.note_scan(False, info["duration_ms"], files, info["metadata_ms"])
        return folders, dict(info)
    except BaseException as exc:
        with _lock:
            _inflight.pop(key, None)
        flight.error = exc
        raise
    finally:
        flight.done.set()


def invalidate(root: Optional[str] = None, *, drop_inflight: bool = True) -> None:
    """Drop cached/in-flight scans.

    ``root=None`` drops everything (used by delete, move and settings changes).
    A specific root only drops scans for that root and starts a new generation,
    so a scan already running for the old generation cannot repopulate cache.

    ``drop_inflight=False`` performs a *soft* invalidation: completed cache
    entries are dropped but a scan that is currently running is left joinable.
    Monitor start uses this so a concurrent ``/Gallery/images`` scan is shared
    instead of being thrown away and repeated.
    """
    global _global_generation
    with _lock:
        if root is None:
            _cache.clear()
            if drop_inflight:
                _global_generation += 1
                _inflight.clear()
            return
        try:
            root_norm = os.path.normcase(os.path.realpath(root))
        except (OSError, ValueError):
            root_norm = os.path.normcase(os.path.abspath(root))
        if drop_inflight:
            _root_generations[root_norm] = _root_generations.get(root_norm, 0) + 1
            for key in [key for key in _inflight if key[0] == root_norm]:
                _inflight.pop(key, None)
        for key in [key for key in _cache if key[0] == root_norm]:
            _cache.pop(key, None)


def cache_size() -> int:
    with _lock:
        return len(_cache)
