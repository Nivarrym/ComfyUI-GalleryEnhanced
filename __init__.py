# __init__.py

# Import and expose the node
from .server import *
from .gallery_node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .unload_node import (
    NODE_CLASS_MAPPINGS as UNLOAD_NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as UNLOAD_NODE_DISPLAY_NAME_MAPPINGS,
)
from .load_image_gallery_node import (
    NODE_CLASS_MAPPINGS as GALLERY_IMAGE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as GALLERY_IMAGE_DISPLAY_NAME_MAPPINGS,
)

NODE_CLASS_MAPPINGS.update(UNLOAD_NODE_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS.update(UNLOAD_NODE_DISPLAY_NAME_MAPPINGS)
NODE_CLASS_MAPPINGS.update(GALLERY_IMAGE_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS.update(GALLERY_IMAGE_DISPLAY_NAME_MAPPINGS)

# Add ComfyUI root to sys.path HERE
import sys
import os
comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(comfy_path)

WEB_DIRECTORY = "./web/dist/assets"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY'] 
