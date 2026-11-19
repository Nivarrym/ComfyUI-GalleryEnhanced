"""Single, safe resolver for gallery asset paths.

All user supplied asset paths (metadata, thumbnail, delete, move) go through
:func:`resolve_gallery_path` so that the same rules apply everywhere:

* only the ``/static_gallery/...`` URL form is accepted (the same form used by
  ``image.url`` in ``/Gallery/images``);
* the value is URL-decoded once;
* ``..`` segments, absolute paths, Windows drive letters and NUL bytes are
  rejected;
* the resolved *real* path (symlinks followed) must stay inside the real
  gallery static root.

The module has no ComfyUI imports so it can be unit tested standalone.
"""

from __future__ import annotations

import os
import re
import urllib.parse
from dataclasses import dataclass

STATIC_PREFIX = "/static_gallery"

_DRIVE_RE = re.compile(r"^[A-Za-z]:")


class GalleryPathError(Exception):
    """A path could not be safely resolved.

    ``status`` is the HTTP status the caller should use for the failure.
    """

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = int(status)


@dataclass(frozen=True)
class ResolvedGalleryPath:
    """Result of :func:`resolve_gallery_path`."""

    #: Absolute real (symlink-resolved) filesystem path.
    path: str
    #: The value the caller supplied, unchanged.
    requested: str
    #: Absolute real gallery root.
    root: str
    #: Path relative to the root using ``/`` separators ("" for the root).
    relative: str


def _normcase(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def is_within_root(path: str, root: str) -> bool:
    """Return True when *path* is inside *root* (both may be relative)."""
    try:
        norm_root = _normcase(root)
        norm_path = _normcase(path)
        return os.path.commonpath([norm_path, norm_root]) == norm_root
    except ValueError:
        # Different drives on Windows.
        return False


def safe_realpath(path: str) -> str:
    """``os.path.realpath`` that never raises for odd input."""
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        return os.path.abspath(path)


def resolve_gallery_path(static_root: str, raw_path: object) -> ResolvedGalleryPath:
    """Resolve a ``/static_gallery/...`` value against *static_root*.

    Raises :class:`GalleryPathError` with ``status`` 400 for malformed paths and
    403 when the real path escapes the root.  The returned path is not required
    to exist -- callers decide between 404 and directory rejection.
    """

    if not isinstance(raw_path, str) or not raw_path.strip():
        raise GalleryPathError("path is required", 400)
    if "\x00" in raw_path:
        raise GalleryPathError("Invalid path", 400)

    decoded = urllib.parse.unquote(raw_path.strip())
    if "\x00" in decoded:
        raise GalleryPathError("Invalid path", 400)

    # Treat backslashes as separators so Windows-style traversals are caught.
    candidate = decoded.replace("\\", "/")

    if candidate == STATIC_PREFIX:
        relative = ""
    elif candidate.startswith(STATIC_PREFIX + "/"):
        relative = candidate[len(STATIC_PREFIX) + 1:]
    else:
        raise GalleryPathError(
            "Invalid path format: expected /static_gallery/...", 400
        )

    segments = [segment for segment in relative.split("/") if segment not in ("", ".")]
    if any(segment == ".." for segment in segments):
        raise GalleryPathError("Path traversal is not allowed", 400)
    if relative.startswith("/") or candidate.startswith("//"):
        raise GalleryPathError("Absolute paths are not allowed", 400)
    if _DRIVE_RE.match(relative) or _DRIVE_RE.match(segments[0] if segments else ""):
        raise GalleryPathError("Absolute paths are not allowed", 400)

    root_real = safe_realpath(static_root)
    if segments:
        full_path = os.path.normpath(os.path.join(root_real, *segments))
    else:
        full_path = root_real

    real_path = safe_realpath(full_path)
    if not is_within_root(real_path, root_real):
        raise GalleryPathError("Access denied: path outside of gallery root", 403)

    rel_posix = os.path.relpath(real_path, root_real).replace("\\", "/")
    if rel_posix == ".":
        rel_posix = ""

    if not rel_posix:
        raise GalleryPathError("Path must point to a file, not the gallery root", 400)

    return ResolvedGalleryPath(
        path=real_path,
        requested=raw_path,
        root=root_real,
        relative=rel_posix,
    )


def resolve_local_path(
    static_root: str,
    raw_path: object,
    *,
    strip_basename: bool = True,
) -> ResolvedGalleryPath:
    """Resolve a local/relative value used by the legacy ``/Gallery/move`` API.

    Unlike :func:`resolve_gallery_path` this accepts absolute filesystem paths
    and paths relative to the gallery root (including the legacy
    ``<root-basename>/sub/file.png`` form).  Containment is always enforced.
    """

    if not isinstance(raw_path, str) or not raw_path.strip():
        raise GalleryPathError("path is required", 400)
    if "\x00" in raw_path:
        raise GalleryPathError("Invalid path", 400)

    candidate = urllib.parse.unquote(raw_path.strip()).replace("\\", "/")
    root_real = safe_realpath(static_root)

    if candidate == STATIC_PREFIX or candidate.startswith(STATIC_PREFIX + "/"):
        return resolve_gallery_path(static_root, candidate)

    root_name = os.path.basename(root_real)
    if strip_basename and root_name:
        prefix = root_name + "/"
        if candidate == root_name:
            candidate = ""
        elif candidate.startswith(prefix):
            candidate = candidate[len(prefix):]

    if os.path.isabs(candidate):
        full_path = os.path.normpath(candidate)
    else:
        segments = [segment for segment in candidate.split("/") if segment not in ("", ".")]
        if any(segment == ".." for segment in segments):
            raise GalleryPathError("Path traversal is not allowed", 400)
        full_path = os.path.normpath(os.path.join(root_real, *segments)) if segments else root_real

    real_path = safe_realpath(full_path)
    if not is_within_root(real_path, root_real):
        raise GalleryPathError("Access denied: path outside of gallery root", 403)

    rel_posix = os.path.relpath(real_path, root_real).replace("\\", "/")
    if rel_posix == ".":
        rel_posix = ""

    return ResolvedGalleryPath(
        path=real_path,
        requested=raw_path,
        root=root_real,
        relative=rel_posix,
    )
