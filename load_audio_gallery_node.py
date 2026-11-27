"""Load an audio file from ComfyUI's output tree as an AUDIO object."""

from __future__ import annotations

from .gallery_media_common import AUDIO_EXTENSIONS, GalleryMediaNode
from .gallery_node_utils import resolve_asset


class LoadAudioFromGallery(GalleryMediaNode):
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

        path = resolve_asset(audio, self.EXTENSIONS)
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


NODE_CLASS_MAPPINGS = {"LoadAudioFromGallery": LoadAudioFromGallery}
NODE_DISPLAY_NAME_MAPPINGS = {"LoadAudioFromGallery": "Load Audio From Gallery"}
