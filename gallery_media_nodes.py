"""Video/audio loaders for assets in ComfyUI's output tree."""

from __future__ import annotations

import os

VIDEO_EXTENSIONS = frozenset({".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"})
AUDIO_EXTENSIONS = frozenset({".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg", ".opus"})


def _output_root() -> str:
    import folder_paths

    return os.path.realpath(folder_paths.get_output_directory())


def _iter_assets(extensions: frozenset[str]) -> list[str]:
    root = _output_root()
    found: list[str] = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for filename in files:
            if os.path.splitext(filename)[1].lower() not in extensions:
                continue
            full_path = os.path.join(base, filename)
            found.append(os.path.relpath(full_path, root).replace(os.sep, "/"))
    found.sort(key=str.casefold)
    return found


def _resolve(relative: str, extensions: frozenset[str]) -> str:
    root = _output_root()
    relative = str(relative).replace("\\", "/").strip().lstrip("/")
    if not relative:
        raise ValueError("No gallery asset selected")
    full_path = os.path.realpath(os.path.join(root, relative.replace("/", os.sep)))
    try:
        inside_root = os.path.commonpath([root, full_path]) == root
    except ValueError:
        inside_root = False
    if not inside_root:
        raise ValueError("Asset path is outside the ComfyUI output directory")
    if not os.path.isfile(full_path):
        raise ValueError(f"Asset not found: {relative}")
    if os.path.splitext(full_path)[1].lower() not in extensions:
        raise ValueError(f"Unsupported asset type: {relative}")
    return full_path


def _revision(path: str):
    try:
        stat = os.stat(path)
    except OSError:
        return float("NaN")
    return f"{getattr(stat, 'st_mtime_ns', int(stat.st_mtime * 1_000_000_000))}-{stat.st_size}"


class _GalleryMediaNode:
    EXTENSIONS: frozenset[str] = frozenset()
    INPUT_NAME = "asset"
    FUNCTION = "load_asset"

    @classmethod
    def INPUT_TYPES(cls):
        files = _iter_assets(cls.EXTENSIONS)
        return {
            "required": {
                cls.INPUT_NAME: (
                    files if files else [""],
                    {
                        "tooltip": (
                            "Assets from the ComfyUI output directory and its "
                            "subfolders, including files from previous sessions."
                        ),
                    },
                ),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        value = kwargs.get(cls.INPUT_NAME)
        try:
            _resolve(value, cls.EXTENSIONS)
        except (OSError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        try:
            return _revision(_resolve(kwargs.get(cls.INPUT_NAME), cls.EXTENSIONS))
        except (OSError, ValueError):
            return float("NaN")


class LoadVideoFromGallery(_GalleryMediaNode):
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
        path = _resolve(video, self.EXTENSIONS)
        from comfy_api.latest import InputImpl

        return (InputImpl.VideoFromFile(path),)


class LoadAudioFromGallery(_GalleryMediaNode):
    """Load an audio file from ComfyUI's output directory as an AUDIO object."""

    EXTENSIONS = AUDIO_EXTENSIONS
    INPUT_NAME = "audio"
    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("AUDIO",)
    FUNCTION = "load_audio"
    CATEGORY = "audio"
    DESCRIPTION = (
        "Load audio from the ComfyUI output directory or its subfolders, "
        "including previous sessions."
    )
    SEARCH_ALIASES = ["load audio", "gallery audio", "output audio"]

    @staticmethod
    def _f32_pcm(wav):
        import torch

        if wav.dtype.is_floating_point:
            return wav
        if wav.dtype == torch.int16:
            return wav.float() / (2 ** 15)
        if wav.dtype == torch.int32:
            return wav.float() / (2 ** 31)
        raise ValueError(f"Unsupported wav dtype: {wav.dtype}")

    def load_audio(self, audio):
        import av
        import torch

        path = _resolve(audio, self.EXTENSIONS)
        with av.open(path) as container:
            if not container.streams.audio:
                raise ValueError(f"No audio stream found in: {audio}")
            stream = container.streams.audio[0]
            sample_rate = stream.codec_context.sample_rate
            channels = stream.channels

            frames = []
            for frame in container.decode(streams=stream.index):
                buffer = torch.from_numpy(frame.to_ndarray())
                if buffer.shape[0] != channels:
                    buffer = buffer.view(-1, channels).t()
                frames.append(buffer)

            if not frames:
                raise ValueError(f"No audio frames decoded from: {audio}")
            waveform = torch.cat(frames, dim=1)
            waveform = self._f32_pcm(waveform)

        return ({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},)


NODE_CLASS_MAPPINGS = {
    "LoadVideoFromGallery": LoadVideoFromGallery,
    "LoadAudioFromGallery": LoadAudioFromGallery,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadVideoFromGallery": "Load Video From Gallery",
    "LoadAudioFromGallery": "Load Audio From Gallery",
}
