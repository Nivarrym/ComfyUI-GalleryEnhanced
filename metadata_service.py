"""Lazy, cached per-asset metadata extraction.

``/Gallery/images`` no longer opens every image.  The frontend asks for one
asset at a time through ``/Gallery/metadata`` and this LRU cache serves repeats.
Keys include the real path, mtime and size, so touching/replacing a file is a
cache miss automatically; :func:`invalidate` additionally drops entries (used by
delete/move).
"""

from __future__ import annotations

import os
import threading
from collections import OrderedDict
from typing import Any, Dict, Optional, Tuple

DEFAULT_MAX_ENTRIES = 512

_lock = threading.Lock()
_cache: "OrderedDict[Tuple[str, int, int], Dict[str, Any]]" = OrderedDict()
_max_entries = DEFAULT_MAX_ENTRIES


def configure(max_entries: Optional[int] = None) -> None:
    global _max_entries
    if max_entries is None:
        return
    with _lock:
        _max_entries = max(1, int(max_entries))
        while len(_cache) > _max_entries:
            _cache.popitem(last=False)


def _cache_key(real_path: str, stat_result: os.stat_result) -> Tuple[str, int, int]:
    mtime_ns = getattr(stat_result, "st_mtime_ns", int(stat_result.st_mtime * 1_000_000_000))
    return (os.path.normcase(real_path), int(mtime_ns), int(stat_result.st_size))


def get_metadata(full_path: str) -> Tuple[Dict[str, Any], bool]:
    """Return ``(metadata, cached)`` for an existing file.

    Raises ``FileNotFoundError`` if the file vanished and propagates Pillow
    errors so HTTP callers can map them to 404/415.
    """
    real_path = os.path.realpath(full_path)
    stat_result = os.stat(real_path)
    key = _cache_key(real_path, stat_result)

    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached, True

    # Imported lazily so this module stays importable without Pillow until used.
    from .metadata_extractor import buildMetadata
    from . import gallery_perf

    with gallery_perf.timer("metadata", file=os.path.basename(real_path)):
        _img, _prompt, metadata = buildMetadata(real_path)
    metadata = metadata if isinstance(metadata, dict) else {}

    with _lock:
        _cache[key] = metadata
        _cache.move_to_end(key)
        while len(_cache) > _max_entries:
            _cache.popitem(last=False)

    return metadata, False


def invalidate(full_path: str) -> None:
    """Drop all cached metadata entries for one real path."""
    try:
        real_norm = os.path.normcase(os.path.realpath(full_path))
    except (OSError, ValueError):
        real_norm = os.path.normcase(os.path.abspath(full_path))
    with _lock:
        for key in [key for key in _cache if key[0] == real_norm]:
            _cache.pop(key, None)


def invalidate_all() -> None:
    with _lock:
        _cache.clear()


def size() -> int:
    with _lock:
        return len(_cache)
