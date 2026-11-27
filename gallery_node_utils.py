"""Shared filesystem helpers for the gallery loader nodes.

All node files use this module instead of keeping private copies of output-root
resolution, annotation parsing, path containment and revision strings.
"""

from __future__ import annotations

import os
import re

ANNOTATION_RE = re.compile(r"\s*\[(input|output|temp)\]\s*$", re.IGNORECASE)


def output_root() -> str:
    import folder_paths

    return os.path.realpath(folder_paths.get_output_directory())


def root_for_value(value: str) -> str:
    """Resolve the [input]/[output]/[temp] annotation of a combo value."""
    import folder_paths

    match = ANNOTATION_RE.search(str(value))
    kind = match.group(1).lower() if match else "output"
    if kind == "input":
        return os.path.realpath(folder_paths.get_input_directory())
    if kind == "temp":
        return os.path.realpath(folder_paths.get_temp_directory())
    return output_root()


def normalize_relative(value: str) -> str:
    """Strip the UI annotation and normalize separators."""
    return ANNOTATION_RE.sub("", str(value)).replace("\\", "/").strip().lstrip("/")


def iter_assets(
    extensions: frozenset[str],
    *,
    annotate_output: bool = False,
) -> list[str]:
    """List files under output, sorted case-insensitively.

    ``annotate_output`` is used by the image node because ComfyUI's frontend
    image/mask pipeline expects the ``[output]`` marker.
    """
    root = output_root()
    found: list[str] = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for filename in files:
            if os.path.splitext(filename)[1].lower() not in extensions:
                continue
            full_path = os.path.join(base, filename)
            relative = os.path.relpath(full_path, root).replace(os.sep, "/")
            found.append(f"{relative} [output]" if annotate_output else relative)
    found.sort(key=str.casefold)
    return found


def resolve_asset(
    value: str,
    extensions: frozenset[str],
    *,
    kind: str = "asset",
    allow_input: bool = True,
) -> str:
    """Resolve a gallery combo value and enforce root containment."""
    raw = str(value)
    root = root_for_value(raw) if allow_input else output_root()
    relative = normalize_relative(raw)
    if not relative:
        raise ValueError(f"No gallery {kind} selected")
    full_path = os.path.realpath(os.path.join(root, relative.replace("/", os.sep)))
    try:
        inside_root = os.path.commonpath([root, full_path]) == root
    except ValueError:
        inside_root = False
    if not inside_root:
        raise ValueError(f"{kind.capitalize()} path is outside the ComfyUI image directory")
    if not os.path.isfile(full_path):
        raise ValueError(f"{kind.capitalize()} not found: {relative}")
    if os.path.splitext(full_path)[1].lower() not in extensions:
        raise ValueError(f"Unsupported {kind} type: {relative}")
    return full_path


def revision(path: str) -> str | float:
    """Stable cache token for a loaded file; NaN forces re-execution on error."""
    try:
        stat = os.stat(path)
    except OSError:
        return float("NaN")
    return f"{getattr(stat, 'st_mtime_ns', int(stat.st_mtime * 1_000_000_000))}-{stat.st_size}"


def input_types(input_name: str, values: list[str], tooltip: str) -> dict:
    return {
        "required": {
            input_name: (
                values if values else [""],
                {"tooltip": tooltip},
            ),
        },
    }


def validate(value: str, extensions: frozenset[str], *, kind: str = "asset") -> str | bool:
    try:
        resolve_asset(value, extensions, kind=kind)
    except (OSError, ValueError) as error:
        return str(error)
    return True


def changed(value: str, extensions: frozenset[str], *, kind: str = "asset") -> str | float:
    try:
        return revision(resolve_asset(value, extensions, kind=kind))
    except (OSError, ValueError):
        return float("NaN")
