import os
import uuid
import asyncio
import logging
import math
import shutil
from concurrent.futures import ThreadPoolExecutor

from fastapi import UploadFile, HTTPException, status
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.user import User
from app.models.user_creative import UserCreative, CreativeFileType, ProcessingStatus
from app.models.space import Space, Screen
from app.utils.file_validation import (
    validate_upload, read_validated_content, validate_magic_bytes, sanitize_filename,
    IMAGE_PDF_EXTENSIONS, VIDEO_EXTENSIONS,
)
from app.utils.malware_scan import scan_file
from app.utils.thumbnails import generate_image_thumbnail, generate_video_thumbnail, convert_heic_to_jpeg
from app.utils.media_processor import (
    TARGET_RESOLUTIONS, TARGET_DURATION,
    get_target_resolution,
    ensure_image_resolution, ensure_video_resolution,
    process_video,
    rotate_media, crop_media,
)
from app.schemas.user_creative import (
    UserCreativeListResponse, UserCreativeResponse,
    CampaignValidationResponse, ValidationIssue,
    EditorRequest,
)

logger = logging.getLogger(__name__)

# Ensure FFmpeg is on PATH (installed at C:\ffmpeg\...)
_FFMPEG_BIN = r"C:\ffmpeg\ffmpeg-8.1-full_build\bin"
if _FFMPEG_BIN not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _FFMPEG_BIN + os.pathsep + os.environ.get("PATH", "")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
CREATIVES_DIR = os.path.join(UPLOAD_DIR, "creatives")
THUMBS_DIR = os.path.join(CREATIVES_DIR, "thumbs")

_executor = ThreadPoolExecutor(max_workers=2)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "heic", "heif"}
VAULT_VIDEO_EXTENSIONS = {"mp4", "mov", "avi", "webm"}


def _detect_file_type(ext: str) -> CreativeFileType:
    if ext in IMAGE_EXTENSIONS:
        return CreativeFileType.image
    return CreativeFileType.video


def _compute_aspect_ratio(width: int, height: int) -> str:
    """Compute aspect ratio as simplified string like '16:9'."""
    if width <= 0 or height <= 0:
        return "unknown"
    g = math.gcd(width, height)
    return f"{width // g}:{height // g}"


async def upload_user_creative(db: Session, user: User, file: UploadFile) -> UserCreative:
    """Upload a creative to the user's vault. Returns immediately; processing runs in background."""
    ext = validate_upload(file.filename)
    if ext == "pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF files are not supported in the creative vault")

    content = await read_validated_content(file)

    header = content[:16]
    if not validate_magic_bytes(header, ext):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match its extension. The file may be corrupted or disguised.",
        )

    original_name = sanitize_filename(file.filename or "unnamed")

    os.makedirs(CREATIVES_DIR, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(CREATIVES_DIR, stored_name)
    with open(file_path, "wb") as f:
        f.write(content)

    file_type = _detect_file_type(ext)
    file_url = f"/uploads/creatives/{stored_name}"
    creative = UserCreative(
        user_id=user.id,
        original_filename=original_name,
        stored_filename=stored_name,
        file_url=file_url,
        original_url=file_url,  # preserve original forever
        file_type=file_type,
        file_size_bytes=len(content),
        processing_status=ProcessingStatus.processing,
        processing_step="scanning",
    )
    db.add(creative)
    db.commit()
    db.refresh(creative)

    creative_id = creative.id
    asyncio.create_task(_process_creative_background(creative_id))

    return creative


async def _process_creative_background(creative_id: int):
    """Background task: full processing pipeline."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(_executor, _process_creative_sync, creative_id)
    except Exception as e:
        logger.error("Background processing crashed for creative %d: %s", creative_id, e)


def _process_creative_sync(creative_id: int):
    """Synchronous processing — runs in thread pool. 7-step pipeline."""
    db = SessionLocal()
    try:
        creative = db.query(UserCreative).filter(UserCreative.id == creative_id).first()
        if not creative:
            return

        file_path = os.path.join(UPLOAD_DIR, creative.file_url.lstrip("/").replace("uploads/", "", 1))
        ext = creative.stored_filename.rsplit(".", 1)[-1].lower() if "." in creative.stored_filename else ""
        is_video = ext in VAULT_VIDEO_EXTENSIONS
        is_image = ext in IMAGE_EXTENSIONS

        # Step 1: Scanning
        try:
            creative.processing_step = "scanning"
            db.commit()
            scan_file(file_path)
        except Exception as e:
            logger.warning("Scan step failed for creative %d: %s", creative_id, e)

        # Step 2: Extracting metadata
        try:
            creative.processing_step = "extracting"
            db.commit()
            _extract_metadata(creative, file_path, ext, db)
        except Exception as e:
            logger.warning("Metadata extraction failed for creative %d: %s", creative_id, e)
            creative.processing_error = f"metadata_partial: {str(e)[:200]}"
            db.commit()

        if is_image:
            # Images: pause and wait for user to confirm framing in the editor
            creative.processing_step = "awaiting_editor"
            db.commit()
            logger.info("Creative %d: awaiting editor confirmation", creative_id)
        elif is_video:
            # Videos: proceed with automatic processing (resize + duration)
            creative.processing_step = "processing"
            db.commit()
            logger.info("Creative %d: auto-processing video", creative_id)

            w = creative.width or 1920
            h = creative.height or 1080
            orientation = get_target_resolution(w, h)
            target_w, target_h = TARGET_RESOLUTIONS[orientation]

            out_name = f"{uuid.uuid4().hex}.mp4"
            out_path = os.path.join(CREATIVES_DIR, out_name)

            try:
                process_video(file_path, out_path, target_w, target_h)
            except Exception as e:
                logger.warning("Video processing failed for creative %d: %s", creative_id, e)
                # Fallback: use original file as-is
                out_name = os.path.basename(file_path)
                out_path = file_path
                target_w, target_h = w, h

            processed_url = f"/uploads/creatives/{os.path.basename(out_path)}"
            creative.processed_url = processed_url
            creative.file_url = processed_url
            creative.width = target_w
            creative.height = target_h
            creative.aspect_ratio = _compute_aspect_ratio(target_w, target_h)
            creative.mime_type = "video/mp4"
            creative.duration_seconds = TARGET_DURATION

            # Generate thumbnail
            _generate_thumbnail(creative, out_path, "mp4", db)

            creative.processing_status = ProcessingStatus.ready
            creative.processing_step = None
            db.commit()
            logger.info("Creative %d: video processing complete, status=ready", creative_id)
        else:
            # Unknown type — mark as awaiting editor
            creative.processing_step = "awaiting_editor"
            db.commit()

    except Exception as e:
        logger.error("Processing failed for creative %d: %s", creative_id, e)
        try:
            creative = db.query(UserCreative).filter(UserCreative.id == creative_id).first()
            if creative:
                creative.processing_status = ProcessingStatus.failed
                creative.processing_error = str(e)[:500]
                creative.processing_step = None
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _extract_metadata(creative: UserCreative, file_path: str, ext: str, db: Session):
    """Extract width, height, duration, aspect_ratio, mime_type."""
    if ext in IMAGE_EXTENSIONS:
        _extract_image_metadata(creative, file_path, ext)
    elif ext in VAULT_VIDEO_EXTENSIONS:
        _extract_video_metadata(creative, file_path)
    db.commit()


def _extract_image_metadata(creative: UserCreative, file_path: str, ext: str):
    """Extract image dimensions and MIME type."""
    try:
        if ext in ("heic", "heif"):
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except ImportError:
                pass

        from PIL import Image
        with Image.open(file_path) as img:
            creative.width = img.width
            creative.height = img.height
            creative.aspect_ratio = _compute_aspect_ratio(img.width, img.height)
            mime_map = {
                "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "gif": "image/gif", "webp": "image/webp", "heic": "image/heic", "heif": "image/heif",
            }
            creative.mime_type = mime_map.get(ext, f"image/{ext}")
    except Exception as e:
        logger.warning("Image metadata extraction error: %s", e)
        raise


def _extract_video_metadata(creative: UserCreative, file_path: str):
    """Extract video dimensions, duration, and MIME type via ffprobe."""
    try:
        import ffmpeg
        probe = ffmpeg.probe(file_path)
        video_stream = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
        if video_stream:
            creative.width = int(video_stream.get("width", 0))
            creative.height = int(video_stream.get("height", 0))
            if creative.width and creative.height:
                creative.aspect_ratio = _compute_aspect_ratio(creative.width, creative.height)
        fmt = probe.get("format", {})
        duration = fmt.get("duration")
        if duration:
            creative.duration_seconds = float(duration)
        mime_map = {"mp4": "video/mp4", "mov": "video/quicktime", "avi": "video/x-msvideo", "webm": "video/webm"}
        ext = file_path.rsplit(".", 1)[-1].lower()
        creative.mime_type = mime_map.get(ext, "video/mp4")
    except Exception as e:
        logger.warning("ffprobe failed for %s: %s — setting ready with null metadata", file_path, e)
        creative.processing_error = f"metadata_partial: ffprobe unavailable"


def _generate_thumbnail(creative: UserCreative, file_path: str, ext: str, db: Session):
    """Generate thumbnail for the creative."""
    os.makedirs(THUMBS_DIR, exist_ok=True)
    thumb_name = f"{uuid.uuid4().hex}_thumb.jpg"
    thumb_path = os.path.join(THUMBS_DIR, thumb_name)

    success = False
    if ext in IMAGE_EXTENSIONS:
        if ext in ("heic", "heif"):
            converted_path = file_path + ".converted.jpg"
            if convert_heic_to_jpeg(file_path, converted_path):
                success = generate_image_thumbnail(converted_path, thumb_path)
                try:
                    os.remove(converted_path)
                except OSError:
                    pass
            else:
                success = generate_image_thumbnail(file_path, thumb_path)
        else:
            success = generate_image_thumbnail(file_path, thumb_path)
    elif ext in VAULT_VIDEO_EXTENSIONS or ext == "mp4":
        success = generate_video_thumbnail(file_path, thumb_path)

    if success:
        creative.thumbnail_url = f"/uploads/creatives/thumbs/{thumb_name}"
        db.commit()


# ---------------------------------------------------------------------------
# Editor transform (crop/rotate)
# ---------------------------------------------------------------------------

def apply_editor_transform(db: Session, user: User, creative_id: int, request: EditorRequest) -> UserCreative:
    """Apply rotation and/or crop from the LEADS Editor, then process to final resolution."""
    creative = get_user_creative(db, user, creative_id)

    # Accept both first-time (awaiting_editor) and re-edit (ready)
    is_first_process = (
        creative.processing_status == ProcessingStatus.processing
        and creative.processing_step == "awaiting_editor"
    )

    if not is_first_process and creative.processing_status != ProcessingStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Creative must be ready or awaiting editor before editing.",
        )

    # For first-time: work on the original uploaded file
    # For re-edit: work on the current processed file
    if is_first_process:
        current_url = creative.original_url or creative.file_url
    else:
        current_url = creative.processed_url or creative.file_url
    current_filename = os.path.basename(current_url)
    current_path = os.path.join(CREATIVES_DIR, current_filename)
    ext = current_filename.rsplit(".", 1)[-1].lower() if "." in current_filename else "mp4"
    is_video = creative.file_type == CreativeFileType.video

    # Mark as actively processing
    if is_first_process:
        creative.processing_step = "processing"
        db.commit()

    working_path = current_path

    # Apply rotation
    if request.rotation and request.rotation != 0:
        rotated_name = f"{uuid.uuid4().hex}.{ext}"
        rotated_path = os.path.join(CREATIVES_DIR, rotated_name)
        rotate_media(working_path, rotated_path, request.rotation, is_video)
        if working_path != current_path and os.path.exists(working_path):
            os.remove(working_path)
        working_path = rotated_path

    # Apply crop
    if request.crop:
        cropped_name = f"{uuid.uuid4().hex}.{ext}"
        cropped_path = os.path.join(CREATIVES_DIR, cropped_name)
        crop_media(
            working_path, cropped_path,
            request.crop.x, request.crop.y, request.crop.width, request.crop.height,
            is_video,
        )
        if working_path != current_path and os.path.exists(working_path):
            os.remove(working_path)
        working_path = cropped_path

    # Re-read dimensions after transforms
    if is_video:
        try:
            import ffmpeg
            probe = ffmpeg.probe(working_path)
            vs = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
            if vs:
                new_w, new_h = int(vs["width"]), int(vs["height"])
            else:
                new_w, new_h = creative.width or 1920, creative.height or 1080
        except Exception:
            new_w, new_h = creative.width or 1920, creative.height or 1080
    else:
        try:
            from PIL import Image
            with Image.open(working_path) as img:
                new_w, new_h = img.width, img.height
        except Exception:
            new_w, new_h = creative.width or 1920, creative.height or 1080

    # Resize to target resolution
    orientation = get_target_resolution(new_w, new_h)
    target_w, target_h = TARGET_RESOLUTIONS[orientation]
    out_ext = "mp4" if is_video else "jpg"
    final_name = f"{uuid.uuid4().hex}.{out_ext}"
    final_path = os.path.join(CREATIVES_DIR, final_name)

    try:
        if is_first_process and is_video:
            # First-time video: use process_video for duration + resize
            process_video(working_path, final_path, target_w, target_h)
        elif is_video:
            ensure_video_resolution(working_path, final_path, target_w, target_h)
        else:
            ensure_image_resolution(working_path, final_path, target_w, target_h)
    except Exception as e:
        logger.warning("Resolution processing failed after editor: %s", e)
        # Fallback: use the working file as final
        final_name = os.path.basename(working_path)
        final_path = working_path
        target_w, target_h = new_w, new_h

    # Clean up working file if different from final
    if working_path != final_path and working_path != current_path and os.path.exists(working_path):
        os.remove(working_path)

    # Update creative
    processed_url = f"/uploads/creatives/{os.path.basename(final_path)}"
    creative.processed_url = processed_url
    creative.file_url = processed_url
    creative.width = target_w
    creative.height = target_h
    creative.aspect_ratio = _compute_aspect_ratio(target_w, target_h)
    if is_video:
        creative.mime_type = "video/mp4"
    else:
        creative.mime_type = "image/jpeg"

    # Regenerate thumbnail
    ext_for_thumb = os.path.basename(final_path).rsplit(".", 1)[-1].lower()
    _generate_thumbnail(creative, final_path, ext_for_thumb, db)

    # Finalize status
    creative.processing_status = ProcessingStatus.ready
    creative.processing_step = None

    db.commit()
    db.refresh(creative)
    return creative


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def get_user_creatives(db: Session, user: User, page: int = 1, page_size: int = 20, file_type: str | None = None) -> dict:
    """Paginated list of user's vault creatives."""
    query = db.query(UserCreative).filter(UserCreative.user_id == user.id)
    if file_type and file_type in ("image", "video"):
        query = query.filter(UserCreative.file_type == file_type)
    total = query.count()
    total_pages = max(1, math.ceil(total / page_size))
    items = query.order_by(UserCreative.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def get_user_creative(db: Session, user: User, creative_id: int) -> UserCreative:
    """Get a single creative, verifying ownership."""
    creative = db.query(UserCreative).filter(
        UserCreative.id == creative_id, UserCreative.user_id == user.id
    ).first()
    if not creative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Creative not found")
    return creative


def delete_user_creative(db: Session, user: User, creative_id: int) -> None:
    """Delete creative from DB and disk."""
    creative = get_user_creative(db, user, creative_id)

    # Remove processed file
    if creative.processed_url:
        proc_path = os.path.join(CREATIVES_DIR, os.path.basename(creative.processed_url))
        if os.path.exists(proc_path):
            os.remove(proc_path)

    # Remove original file
    file_path = os.path.join(CREATIVES_DIR, creative.stored_filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    # Remove original_url file (if different from stored)
    if creative.original_url:
        orig_path = os.path.join(CREATIVES_DIR, os.path.basename(creative.original_url))
        if os.path.exists(orig_path) and orig_path != file_path:
            os.remove(orig_path)

    # Remove thumbnail
    if creative.thumbnail_url:
        thumb_file = os.path.basename(creative.thumbnail_url)
        thumb_path = os.path.join(THUMBS_DIR, thumb_file)
        if os.path.exists(thumb_path):
            os.remove(thumb_path)

    db.delete(creative)
    db.commit()


def validate_creative_for_campaign(
    db: Session, user: User, creative_id: int, space_id: int
) -> CampaignValidationResponse:
    """Validate a vault creative against a space's screen requirements."""
    creative = get_user_creative(db, user, creative_id)

    if creative.processing_status != ProcessingStatus.ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Creative is still processing. Please wait until it's ready.",
        )

    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    issues: list[ValidationIssue] = []

    screen = db.query(Screen).filter(Screen.space_id == space_id).first()
    if screen and creative.width and creative.height:
        screen_w = screen.resolution_width if hasattr(screen, 'resolution_width') else None
        screen_h = screen.resolution_height if hasattr(screen, 'resolution_height') else None
        if screen_w and screen_h:
            if creative.width != screen_w or creative.height != screen_h:
                issues.append(ValidationIssue(
                    type="warning",
                    code="resolution_mismatch",
                    message=f"This asset is {creative.width}x{creative.height} but the screen requires {screen_w}x{screen_h}. Crop tool available in editor.",
                ))

    if creative.file_type == CreativeFileType.video:
        ext = creative.stored_filename.rsplit(".", 1)[-1].lower() if "." in creative.stored_filename else ""
        if ext in ("mov", "avi"):
            issues.append(ValidationIssue(
                type="warning",
                code="format_conversion",
                message=f"{ext.upper()} format will be converted to MP4 automatically.",
            ))

        if creative.duration_seconds:
            if creative.duration_seconds > 10:
                issues.append(ValidationIssue(
                    type="warning",
                    code="duration_long",
                    message=f"This video is {creative.duration_seconds:.0f}s, it will be trimmed to 10s upon finalization.",
                ))
            elif creative.duration_seconds < 10:
                issues.append(ValidationIssue(
                    type="warning",
                    code="duration_short",
                    message=f"This video is {creative.duration_seconds:.1f}s. It may be looped to fill the 10s slot.",
                ))

    return CampaignValidationResponse(
        valid=len(issues) == 0,
        issues=issues,
    )
