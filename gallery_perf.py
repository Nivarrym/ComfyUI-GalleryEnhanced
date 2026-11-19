"""Tiny, thread-safe performance instrumentation for the gallery backend.

The ring buffer keeps the last :data:`MAX_RECORDS` phase timings.  Recording is
always on (it is extremely cheap); :func:`configure` controls whether a compact
log line is printed for every recorded phase.  There is never a log line per
file -- callers only time phases (scan, metadata, thumbnail, ...).
"""

from __future__ import annotations

import collections
import contextlib
import threading
import time
from typing import Any, Dict, Iterator, List, Optional

from . import gallery_config

MAX_RECORDS = 200

_lock = threading.Lock()
_records: "collections.deque[Dict[str, Any]]" = collections.deque(maxlen=MAX_RECORDS)
_enabled = False

_scan_stats: Dict[str, Any] = {
    "count": 0,
    "hits": 0,
    "misses": 0,
    "last_ms": 0.0,
    "total_ms": 0.0,
    "last_files": 0,
    "last_metadata_ms": 0.0,
}

_thumbnail_stats: Dict[str, Any] = {
    "count": 0,
    "hits": 0,
    "misses": 0,
    "last_ms": 0.0,
    "total_ms": 0.0,
    "last_width": 0,
    "last_bytes": 0,
}


def configure(enabled: bool) -> None:
    """Enable/disable the compact per-phase debug log lines."""
    global _enabled
    _enabled = bool(enabled)
    gallery_config.debug_perf = _enabled


def is_enabled() -> bool:
    return _enabled


def _log(label: str, ms: float, fields: Dict[str, Any]) -> None:
    if not _enabled:
        return
    parts = [f"{label}", f"{ms:.1f}ms"]
    for key, value in fields.items():
        if isinstance(value, float):
            parts.append(f"{key}={value:.1f}")
        else:
            parts.append(f"{key}={value}")
    # gallery_log honours disable_logs; one line per phase only.
    gallery_config.gallery_log("[GalleryPerf] " + " ".join(parts))


def record(label: str, ms: float, **fields: Any) -> Dict[str, Any]:
    """Store one timing record and optionally log it."""
    entry = {"label": str(label), "ms": round(float(ms), 3), "ts": time.time()}
    if fields:
        entry.update(fields)
    with _lock:
        _records.append(entry)
    _log(label, float(ms), fields)
    return entry


@contextlib.contextmanager
def timer(label: str, **fields: Any) -> Iterator[Dict[str, Any]]:
    """Time a phase.

    ``with timer("scan", cache="miss"): ...`` records the elapsed milliseconds.
    The yielded dict can be used to add fields discovered while running.
    """
    started = time.perf_counter()
    extra: Dict[str, Any] = {}
    try:
        yield extra
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        merged = dict(fields)
        merged.update(extra)
        record(label, elapsed_ms, **merged)


def get_records() -> List[Dict[str, Any]]:
    with _lock:
        return [dict(entry) for entry in _records]


def reset() -> None:
    """Clear records and aggregate stats."""
    with _lock:
        _records.clear()
        _scan_stats.update(
            count=0, hits=0, misses=0, last_ms=0.0, total_ms=0.0,
            last_files=0, last_metadata_ms=0.0,
        )
        _thumbnail_stats.update(
            count=0, hits=0, misses=0, last_ms=0.0, total_ms=0.0,
            last_width=0, last_bytes=0,
        )


def note_scan(
    cache_hit: bool,
    duration_ms: float,
    files: int = 0,
    metadata_ms: float = 0.0,
) -> None:
    """Account one ``/Gallery/images`` scan result."""
    with _lock:
        _scan_stats["count"] += 1
        if cache_hit:
            _scan_stats["hits"] += 1
        else:
            _scan_stats["misses"] += 1
        _scan_stats["last_ms"] = round(float(duration_ms), 3)
        _scan_stats["total_ms"] += float(duration_ms)
        _scan_stats["last_files"] = int(files)
        _scan_stats["last_metadata_ms"] = round(float(metadata_ms), 3)


def note_thumbnail(
    cache_hit: bool,
    duration_ms: float,
    width: Optional[int] = None,
    size: Optional[int] = None,
) -> None:
    """Account one thumbnail request."""
    with _lock:
        _thumbnail_stats["count"] += 1
        if cache_hit:
            _thumbnail_stats["hits"] += 1
        else:
            _thumbnail_stats["misses"] += 1
        _thumbnail_stats["last_ms"] = round(float(duration_ms), 3)
        _thumbnail_stats["total_ms"] += float(duration_ms)
        if width is not None:
            _thumbnail_stats["last_width"] = int(width)
        if size is not None:
            _thumbnail_stats["last_bytes"] = int(size)


def _public_scan_stats() -> Dict[str, Any]:
    with _lock:
        count = _scan_stats["count"]
        return {
            "count": count,
            "hits": _scan_stats["hits"],
            "misses": _scan_stats["misses"],
            "last_ms": _scan_stats["last_ms"],
            "avg_ms": round(_scan_stats["total_ms"] / count, 3) if count else 0.0,
            "files": _scan_stats["last_files"],
            "metadata_ms": _scan_stats["last_metadata_ms"],
        }


def _public_thumbnail_stats() -> Dict[str, Any]:
    with _lock:
        count = _thumbnail_stats["count"]
        return {
            "count": count,
            "hits": _thumbnail_stats["hits"],
            "misses": _thumbnail_stats["misses"],
            "last_ms": _thumbnail_stats["last_ms"],
            "avg_ms": round(_thumbnail_stats["total_ms"] / count, 3) if count else 0.0,
            "width": _thumbnail_stats["last_width"],
            "bytes": _thumbnail_stats["last_bytes"],
        }


def snapshot() -> Dict[str, Any]:
    """JSON-ready payload for ``GET /Gallery/perf``."""
    return {
        "records": get_records(),
        "scan": _public_scan_stats(),
        "thumbnails": _public_thumbnail_stats(),
    }
