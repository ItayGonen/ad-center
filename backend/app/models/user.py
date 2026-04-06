import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Enum, DateTime, JSON
from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"
    partner = "partner"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password = Column(String(255), nullable=True)
    oauth_provider = Column(String(50), nullable=True)
    oauth_id = Column(String(255), nullable=True)
    name = Column(String(255), nullable=False)
    phone_number = Column(String(50), nullable=True)
    company_name = Column(String(255), nullable=True)
    profile_picture = Column(String(255), nullable=True)
    notification_preferences = Column(JSON, nullable=True)
    language = Column(String(10), nullable=False, default="en")
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
