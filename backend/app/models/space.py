import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Float, Numeric, Enum, DateTime, Time, ForeignKey, Index, Table, Boolean
from sqlalchemy.orm import relationship
from app.database import Base


class EnvironmentType(str, enum.Enum):
    indoor = "indoor"
    outdoor = "outdoor"


class SpaceType(Base):
    __tablename__ = "space_types"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    spaces = relationship("Space", back_populates="space_type")
    translations = relationship("SpaceTypeTranslation", back_populates="space_type", cascade="all, delete-orphan")


class AudienceCategory(str, enum.Enum):
    demographic = "Demographic"
    lifestyle = "Lifestyle"
    behavior = "Behavior / Context"


space_audience_profiles = Table(
    "space_audience_profiles",
    Base.metadata,
    Column("space_id", Integer, ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True),
    Column("audience_profile_id", Integer, ForeignKey("audience_profiles.id", ondelete="CASCADE"), primary_key=True),
)


class AudienceProfile(Base):
    __tablename__ = "audience_profiles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    category = Column(Enum(AudienceCategory), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    spaces = relationship("Space", secondary=space_audience_profiles, back_populates="audience_profiles")
    translations = relationship("AudienceProfileTranslation", back_populates="audience_profile", cascade="all, delete-orphan")


class Space(Base):
    __tablename__ = "spaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    full_address = Column(String(500), nullable=True)
    city = Column(String(255), nullable=False)
    space_type_id = Column(Integer, ForeignKey("space_types.id"), nullable=True)
    environment = Column(Enum(EnvironmentType), nullable=True)
    estimated_daily_impressions = Column(String(100), nullable=True)
    average_dwell_time = Column(Integer, nullable=True)
    number_of_screens = Column(Integer, nullable=True)
    screen_size = Column(String(100), nullable=True)
    resolution = Column(String(100), nullable=True)
    price_per_day = Column(Numeric(10, 2), nullable=False)
    general_description = Column(Text, nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    partner_owner = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    space_type = relationship("SpaceType", back_populates="spaces", lazy="joined")
    partner = relationship("User", foreign_keys=[partner_owner])
    images = relationship("SpaceImage", back_populates="space", cascade="all, delete-orphan")
    operating_hours = relationship("SpaceOperatingHours", back_populates="space", cascade="all, delete-orphan")
    audience_profiles = relationship("AudienceProfile", secondary=space_audience_profiles, back_populates="spaces", lazy="selectin")
    translations = relationship("SpaceTranslation", back_populates="space", cascade="all, delete-orphan")
    screens = relationship("Screen", back_populates="space", cascade="all, delete-orphan")


class SpaceImage(Base):
    __tablename__ = "space_images"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False)
    image_url = Column(String(500), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    space = relationship("Space", back_populates="images")


class SpaceOperatingHours(Base):
    __tablename__ = "space_operating_hours"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=Sunday, 6=Saturday
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)

    space = relationship("Space", back_populates="operating_hours")


class Screen(Base):
    __tablename__ = "screens"
    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=True)
    size_inches = Column(String(50), nullable=False)
    resolution_width = Column(Integer, nullable=False)
    resolution_height = Column(Integer, nullable=False)
    position_description = Column(String(500), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    space = relationship("Space", back_populates="screens")
    translations = relationship("ScreenTranslation", back_populates="screen", cascade="all, delete-orphan")
