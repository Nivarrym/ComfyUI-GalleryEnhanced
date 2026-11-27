"""Shared base and extension sets for gallery video/audio loader nodes."""

from __future__ import annotations

from .gallery_node_utils import changed, input_types, iter_assets, validate

VIDEO_EXTENSIONS = frozenset({".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"})
AUDIO_EXTENSIONS = frozenset({".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg", ".opus"})


class GalleryMediaNode:
    """Common combo/validation behavior for output-backed media loaders."""

    EXTENSIONS: frozenset[str] = frozenset()
    INPUT_NAME = "asset"
    FUNCTION = "load_asset"

    @classmethod
    def INPUT_TYPES(cls):
        return input_types(
            cls.INPUT_NAME,
            iter_assets(cls.EXTENSIONS),
            "Assets from the ComfyUI output directory and its subfolders, including files from previous sessions.",
        )

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return validate(kwargs.get(cls.INPUT_NAME), cls.EXTENSIONS)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return changed(kwargs.get(cls.INPUT_NAME), cls.EXTENSIONS)
