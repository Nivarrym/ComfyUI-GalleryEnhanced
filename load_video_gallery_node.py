"""Load a video from ComfyUI's output tree as a VIDEO object."""

from __future__ import annotations

from .gallery_media_common import VIDEO_EXTENSIONS, GalleryMediaNode
from .gallery_node_utils import resolve_asset


class LoadVideoFromGallery(GalleryMediaNode):
    """Load a video file from ComfyUI's output directory as a VIDEO object."""

    EXTENSIONS = VIDEO_EXTENSIONS
    INPUT_NAME = "video"
    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("VIDEO",)
    FUNCTION = "load_video"
    CATEGORY = "video"
    DESCRIPTION = (
        "Load a video from the ComfyUI output directory or its subfolders, "
        "including previous sessions."
    )
    SEARCH_ALIASES = ["load video", "gallery video", "output video"]

    def load_video(self, video):
        path = resolve_asset(video, self.EXTENSIONS)
        from comfy_api.latest import InputImpl

        return (InputImpl.VideoFromFile(path),)


NODE_CLASS_MAPPINGS = {"LoadVideoFromGallery": LoadVideoFromGallery}
NODE_DISPLAY_NAME_MAPPINGS = {"LoadVideoFromGallery": "Load Video From Gallery"}
