"""
Media processing utilities for LEADS creatives.

All functions work on file paths and return output paths.
Uses FFmpeg (via ffmpeg-python) for video and Pillow for images.
"""

import os
import shutil
import logging

logger = logging.getLogger(__name__)


TARGET_RESOLUTIONS = {
    "vertical": (1080, 1920),
    "horizontal": (1920, 1080)
}
TARGET_DURATION = 10  # seconds


# ---------------------------------------------------------------------------
# Target resolution
# ---------------------------------------------------------------------------

def get_target_resolution(width: int, height: int) -> str:
    """Return orientation key: 'horizontal' or 'vertical'."""
    return "horizontal" if width > height else "vertical"


# ---------------------------------------------------------------------------
# Image processing
# ---------------------------------------------------------------------------

def ensure_image_resolution(source: str, output: str, target_w: int, target_h: int) -> None:
    """
    Resize image to exact target dimensions using the same proven approach
    as the LEADS processing script: convert to RGB, resize with LANCZOS,
    save as JPEG quality=95.
    """
    from PIL import Image

    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    with Image.open(source) as img:
        img = img.convert("RGB")
        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
        img.save(output, "JPEG", quality=95)


# ---------------------------------------------------------------------------
# Video processing
# ---------------------------------------------------------------------------

def _process_video_full(source: str, output: str, target_w: int, target_h: int) -> None:
    """
    Full video processing — resize, duration handling, and audio preservation.
    - Probe duration
    - If > 10s: trim to 10s
    - If < 10s: loop video to fill 10s
    - Resize to target resolution
    - Encode with libx264 + aac, preserving audio
    """
    import ffmpeg

    probe = ffmpeg.probe(source)
    duration = float(probe['format'].get('duration', 0))

    # Check if source has an audio stream
    has_audio = any(s for s in probe.get('streams', []) if s.get('codec_type') == 'audio')

    inp = ffmpeg.input(source)
    video = inp.video

    # Apply duration filters to video stream
    if duration > TARGET_DURATION:
        video = video.trim(duration=TARGET_DURATION).setpts('PTS-STARTPTS')
    elif duration < TARGET_DURATION:
        num_loops = int(TARGET_DURATION // duration) + 1
        video = video.filter('loop', loop=num_loops, size=32767).trim(duration=TARGET_DURATION).setpts('PTS-STARTPTS')

    # Combine video + audio (if present) into output
    if has_audio:
        audio = inp.audio
        (
            ffmpeg
            .output(
                video, audio, output,
                vcodec='libx264',
                s=f'{target_w}x{target_h}',
                pix_fmt='yuv420p',
                acodec='aac',
                t=TARGET_DURATION,
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    else:
        (
            video
            .output(
                output,
                vcodec='libx264',
                s=f'{target_w}x{target_h}',
                pix_fmt='yuv420p',
                an=None,
                t=TARGET_DURATION,
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )


def process_video(source: str, output: str, target_w: int, target_h: int) -> None:
    """First-time video processing (upload pipeline)."""
    _process_video_full(source, output, target_w, target_h)


def ensure_video_resolution(source: str, output: str, target_w: int, target_h: int) -> None:
    """Re-edit video processing (editor pipeline)."""
    _process_video_full(source, output, target_w, target_h)


# ---------------------------------------------------------------------------
# Editor transforms: rotate & crop
# ---------------------------------------------------------------------------

def rotate_media(source: str, output: str, degrees: int, is_video: bool) -> None:
    """Rotate media by given degrees (0, 90, 180, 270)."""
    if degrees == 0:
        if os.path.abspath(source) != os.path.abspath(output):
            shutil.copy2(source, output)
        return

    if is_video:
        _rotate_video(source, output, degrees)
    else:
        _rotate_image(source, output, degrees)


def _rotate_image(source: str, output: str, degrees: int) -> None:
    from PIL import Image

    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    with Image.open(source) as img:
        img = img.convert("RGB")
        rotated = img.rotate(-degrees, expand=True)
        rotated.save(output, "JPEG", quality=95)


def _rotate_video(source: str, output: str, degrees: int) -> None:
    import ffmpeg

    # Map degrees to ffmpeg vf filter string
    vf_map = {
        90: "transpose=1",
        180: "hflip,vflip",
        270: "transpose=2",
    }
    vf = vf_map.get(degrees)
    if not vf:
        shutil.copy2(source, output)
        return

    (
        ffmpeg
        .input(source)
        .output(
            output,
            vf=vf,
            vcodec="libx264", crf=1, preset="fast",
            acodec="copy",
            movflags="+faststart",
        )
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )


def crop_media(source: str, output: str, x: int, y: int, w: int, h: int, is_video: bool) -> None:
    """Crop media to the specified rectangle."""
    if is_video:
        _crop_video(source, output, x, y, w, h)
    else:
        _crop_image(source, output, x, y, w, h)


def _crop_image(source: str, output: str, x: int, y: int, w: int, h: int) -> None:
    from PIL import Image

    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    with Image.open(source) as img:
        img = img.convert("RGB")
        cropped = img.crop((x, y, x + w, y + h))
        cropped.save(output, "JPEG", quality=95)


def _crop_video(source: str, output: str, x: int, y: int, w: int, h: int) -> None:
    import ffmpeg

    (
        ffmpeg
        .input(source)
        .output(
            output,
            vf=f"crop={w}:{h}:{x}:{y}",
            vcodec="libx264", crf=1, preset="fast",
            acodec="copy",
            movflags="+faststart",
        )
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )
