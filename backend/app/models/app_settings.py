from sqlalchemy import Column, String, quoted_name
from app.database import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(quoted_name("key", True), String(100), primary_key=True)
    value = Column(String(500), nullable=False)
