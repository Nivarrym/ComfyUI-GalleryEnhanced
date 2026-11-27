"""ComfyUI Gallery entry point and node registration."""

from __future__ import annotations

import os
import sys

from .server import *  # noqa: F401,F403 - starts the gallery API/monitor
from . import (
    gallery_button_node,
    load_audio_gallery_node,
    load_image_gallery_node,
    load_video_gallery_node,
)

_NODE_MODULES = (
    gallery_button_node,
    load_image_gallery_node,
    load_video_gallery_node,
    load_audio_gallery_node,
)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _module in _NODE_MODULES:
    NODE_CLASS_MAPPINGS.update(_module.NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_module.NODE_DISPLAY_NAME_MAPPINGS)

# Add ComfyUI root to sys.path so modules such as ``server`` and ``folder_paths``
# are importable in older standalone-loading setups.
comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(comfy_path)

WEB_DIRECTORY = "./web/dist/assets"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
