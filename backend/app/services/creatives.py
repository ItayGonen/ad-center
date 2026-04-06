import os
import uuid
import logging
from fastapi import UploadFile, HTTPException, status
from sqlalchemy.orm import Session
from app.models.order import Order, OrderCreative, FileType
from app.models.user import User
from app.utils.file_validation import validate_upload, read_validated_content

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")


def _detect_file_type(filename: str) -> FileType:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("jpg", "jpeg", "png", "gif", "webp"):
        return FileType.image
    if ext in ("mp4", "mov", "avi", "webm"):
        return FileType.video
    if ext == "pdf":
        return FileType.pdf
    return FileType.image


async def upload_creative(db: Session, order_id: int, user: User, file: UploadFile) -> OrderCreative:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    # Validate before any side effects
    validate_upload(file.filename)

    existing_count = db.query(OrderCreative).filter(OrderCreative.order_id == order_id).count()
    if existing_count >= 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum 5 creatives per order")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "bin"
    saved_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_name)

    content = await read_validated_content(file)
    with open(file_path, "wb") as f:
        f.write(content)

    file_type = _detect_file_type(file.filename or "file.bin")
    creative = OrderCreative(
        order_id=order_id,
        file_url=f"/uploads/{saved_name}",
        file_type=file_type,
    )
    db.add(creative)
    db.commit()
    db.refresh(creative)
    logger.info("Creative uploaded order_id=%d creative_id=%d type=%s", order_id, creative.id, file_type.value)
    return creative


def get_creatives(db: Session, order_id: int, user: User) -> list[OrderCreative]:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return db.query(OrderCreative).filter(OrderCreative.order_id == order_id).all()


def delete_creative(db: Session, order_id: int, creative_id: int, user: User) -> None:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    creative = db.query(OrderCreative).filter(
        OrderCreative.id == creative_id, OrderCreative.order_id == order_id
    ).first()
    if not creative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Creative not found")
    # Remove file from disk
    file_path = os.path.join(UPLOAD_DIR, os.path.basename(creative.file_url))
    if os.path.exists(file_path):
        os.remove(file_path)
    db.delete(creative)
    db.commit()
