import os
import logging
import subprocess

logger = logging.getLogger(__name__)


def generate_image_thumbnail(source_path: str, thumb_path: str, max_size: tuple = (400, 400)) -> bool:
    """Generate a JPEG thumbnail from an image file. Returns True on success."""
    try:
        from PIL import Image, ImageOps
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            pass

        with Image.open(source_path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail(max_size)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
            img.save(thumb_path, "JPEG", quality=85)
        return True
    except Exception as e:
        logger.warning("Failed to generate image thumbnail for %s: %s", source_path, e)
        return False


def generate_video_thumbnail(source_path: str, thumb_path: str, max_size: tuple = (400, 400)) -> bool:
    """Extract a frame from video at 1s (or first frame) and save as JPEG thumbnail."""
    try:
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
        temp_frame = thumb_path + ".tmp.jpg"

        # Try extracting frame at 1 second
        try:
            import ffmpeg
            (
                ffmpeg
                .input(source_path, ss=1)
                .filter('scale', max_size[0], -1)
                .output(temp_frame, vframes=1, format='image2', vcodec='mjpeg')
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        except Exception:
            # Fallback: try first frame
            try:
                import ffmpeg as ff2
                (
                    ff2
                    .input(source_path)
                    .filter('scale', max_size[0], -1)
                    .output(temp_frame, vframes=1, format='image2', vcodec='mjpeg')
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )
            except Exception as e2:
                logger.warning("ffmpeg thumbnail extraction failed for %s: %s", source_path, e2)
                if os.path.exists(temp_frame):
                    os.remove(temp_frame)
                return False

        if os.path.exists(temp_frame) and os.path.getsize(temp_frame) > 0:
            # Resize with Pillow to exact max_size
            try:
                from PIL import Image
                with Image.open(temp_frame) as img:
                    img.thumbnail(max_size)
                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                    img.save(thumb_path, "JPEG", quality=85)
                os.remove(temp_frame)
            except Exception:
                # Just rename the temp frame
                os.rename(temp_frame, thumb_path)
            return True

        if os.path.exists(temp_frame):
            os.remove(temp_frame)
        return False
    except Exception as e:
        logger.warning("Failed to generate video thumbnail for %s: %s", source_path, e)
        return False


def convert_heic_to_jpeg(source_path: str, output_path: str) -> bool:
    """Convert HEIC/HEIF file to JPEG. Returns True on success."""
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
        from PIL import Image, ImageOps

        with Image.open(source_path) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.save(output_path, "JPEG", quality=90)
        return True
    except Exception as e:
        logger.warning("Failed to convert HEIC to JPEG for %s: %s", source_path, e)
        return False
