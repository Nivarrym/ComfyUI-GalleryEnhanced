"""Standalone model-unload node.

Kept in its own module so the gallery can expose a small utility node without
depending on the gallery UI. The node has no required inputs: placing it as an
output node is enough to free every loaded model. An optional wildcard input can
be connected to force execution after a specific loader.
"""

from __future__ import annotations


class UnloadModelsNode:
    """Output node that unloads all models and empties the device cache."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            # Connect anything here to make the unload run after that branch.
            "optional": {"trigger": ("*",)},
        }

    RETURN_TYPES = ()
    FUNCTION = "unload_models"
    CATEGORY = "utils"
    OUTPUT_NODE = True
    DESCRIPTION = (
        "Unloads all models from VRAM/RAM and empties the device cache. "
        "Connect an optional trigger to control execution order."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # A no-input output node would otherwise be cached; always run it.
        return float("NaN")

    def unload_models(self, trigger=None):
        import comfy.model_management as model_management

        model_management.unload_all_models()
        try:
            model_management.soft_empty_cache(force=True)
        except TypeError:
            # Older ComfyUI versions do not accept ``force``.
            model_management.soft_empty_cache()
        return ()


NODE_CLASS_MAPPINGS = {"UnloadModels": UnloadModelsNode}
NODE_DISPLAY_NAME_MAPPINGS = {"UnloadModels": "Unload Models"}
