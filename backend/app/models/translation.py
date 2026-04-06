from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.database import Base


class SpaceTranslation(Base):
    __tablename__ = "space_translations"
    __table_args__ = (
        UniqueConstraint("space_id", "language", "field", name="uq_space_translation"),
        Index("ix_space_trans_lookup", "space_id", "language"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(10), nullable=False)
    field = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)

    space = relationship("Space", back_populates="translations")


class SpaceTypeTranslation(Base):
    __tablename__ = "space_type_translations"
    __table_args__ = (
        UniqueConstraint("space_type_id", "language", "field", name="uq_space_type_translation"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_type_id = Column(Integer, ForeignKey("space_types.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(10), nullable=False)
    field = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)

    space_type = relationship("SpaceType", back_populates="translations")


class AudienceProfileTranslation(Base):
    __tablename__ = "audience_profile_translations"
    __table_args__ = (
        UniqueConstraint("audience_profile_id", "language", "field", name="uq_audience_profile_translation"),
    )

    id = Column(Integer, primary_key=True, index=True)
    audience_profile_id = Column(Integer, ForeignKey("audience_profiles.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(10), nullable=False)
    field = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)

    audience_profile = relationship("AudienceProfile", back_populates="translations")


class ScreenTranslation(Base):
    __tablename__ = "screen_translations"
    __table_args__ = (
        UniqueConstraint("screen_id", "language", "field", name="uq_screen_translation"),
        Index("ix_screen_trans_lookup", "screen_id", "language"),
    )

    id = Column(Integer, primary_key=True, index=True)
    screen_id = Column(Integer, ForeignKey("screens.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(10), nullable=False)
    field = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)

    screen = relationship("Screen", back_populates="translations")


class UITranslation(Base):
    __tablename__ = "ui_translations"
    __table_args__ = (
        UniqueConstraint("namespace", "key", "language", name="uq_ui_translation"),
        Index("ix_ui_trans_lookup", "namespace", "language"),
    )

    id = Column(Integer, primary_key=True, index=True)
    namespace = Column(String(50), nullable=False)
    key = Column(String(255), nullable=False)
    language = Column(String(10), nullable=False)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
