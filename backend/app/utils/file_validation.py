import os
import re

from fastapi import HTTPException, UploadFile, status

ALLOWED_EXTENSIONS = {
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
    "mp4", "mov", "avi", "webm",
    "pdf",
}

# Magic byte signatures for file type validation
MAGIC_SIGNATURES = {
    "jpg":  [(0, b"\xff\xd8\xff")],
    "jpeg": [(0, b"\xff\xd8\xff")],
    "png":  [(0, b"\x89PNG")],
    "gif":  [(0, b"GIF8")],
    "webp": [(0, b"RIFF"), (8, b"WEBP")],
    "heic": [(4, b"ftyp")],
    "heif": [(4, b"ftyp")],
    "mp4":  [(4, b"ftyp")],
    "mov":  [(4, b"ftyp")],
    "avi":  [(0, b"RIFF"), (8, b"AVI ")],
    "webm": [(0, b"\x1a\x45\xdf\xa3")],
}


def validate_magic_bytes(header: bytes, ext: str) -> bool:
    """Check first 12+ bytes against known signatures for the given extension."""
    sigs = MAGIC_SIGNATURES.get(ext)
    if sigs is None:
        # No signature registered — allow (e.g. pdf)
        return True
    for offset, magic in sigs:
        if len(header) < offset + len(magic):
            return False
        if header[offset:offset + len(magic)] != magic:
            return False
    return True


def sanitize_filename(filename: str) -> str:
    """Strip path components, null bytes, and special chars. Limit to 255 chars."""
    # Strip any path separators
    filename = os.path.basename(filename)
    # Remove null bytes
    filename = filename.replace("\x00", "")
    # Replace special characters with underscore (keep letters, digits, dots, hyphens, underscores)
    filename = re.sub(r"[^\w.\-]", "_", filename)
    # Collapse multiple underscores
    filename = re.sub(r"_{2,}", "_", filename)
    # Limit length
    if len(filename) > 255:
        name, ext = os.path.splitext(filename)
        filename = name[:255 - len(ext)] + ext
    return filename or "unnamed"

IMAGE_PDF_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "pdf"}
VIDEO_EXTENSIONS = {"mp4", "mov", "avi", "webm"}

MAX_IMAGE_PDF_SIZE = 10 * 1024 * 1024   # 10 MB
MAX_VIDEO_SIZE = 50 * 1024 * 1024        # 50 MB
CHUNK_SIZE = 64 * 1024                   # 64 KB


def _get_extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def validate_upload(filename: str | None) -> str:
    ext = _get_extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '.{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    return ext


async def read_validated_content(file: UploadFile) -> bytes:
    ext = _get_extension(file.filename)
    max_size = MAX_VIDEO_SIZE if ext in VIDEO_EXTENSIONS else MAX_IMAGE_PDF_SIZE

    chunks = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File too large. Max size: {max_size // (1024 * 1024)} MB",
            )
        chunks.append(chunk)

    return b"".join(chunks)
