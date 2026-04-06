import enum
from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, Float, Text, Enum, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.database import Base


class CreativeFileType(str, enum.Enum):
    image = "image"
    video = "video"


class ProcessingStatus(str, enum.Enum):
    uploading = "uploading"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class UserCreative(Base):
    __tablename__ = "user_creatives"
    __table_args__ = (
        Index("ix_user_creatives_user_type", "user_id", "file_type"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename = Column(String(500), nullable=False)
    stored_filename = Column(String(500), nullable=False)
    file_url = Column(String(500), nullable=False)
    thumbnail_url = Column(String(500), nullable=True)
    file_type = Column(Enum(CreativeFileType), nullable=False)
    mime_type = Column(String(100), nullable=True)
    file_size_bytes = Column(BigInteger, nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    aspect_ratio = Column(String(20), nullable=True)
    processing_status = Column(Enum(ProcessingStatus), default=ProcessingStatus.uploading, nullable=False)
    processing_step = Column(String(50), nullable=True)
    original_url = Column(String(500), nullable=True)
    processed_url = Column(String(500), nullable=True)
    processing_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")
