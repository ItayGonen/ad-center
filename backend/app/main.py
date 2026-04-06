import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session
import os

from app.database import Base, get_db  # noqa: F401 — Base needed for Alembic
from app.models import *  # noqa: F401, F403 — ensure all models are registered
from app.routers import auth, spaces, orders, creatives, admin, notifications, campaigns, partner, translations, my_creatives
from app.logging_config import setup_logging
from app.middleware.request_id import RequestIDMiddleware
from app.routers.auth import limiter
from app.services.auto_cancel import auto_cancel_loop
from app.config import settings
from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import hash_password
import logging

setup_logging()
logger = logging.getLogger(__name__)


def seed_admin():
    """Create an admin user on first startup if ADMIN_INIT_EMAIL is set and no admin exists."""
    if not settings.ADMIN_INIT_EMAIL or not settings.ADMIN_INIT_PASSWORD:
        return
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.role == UserRole.admin).first()
        if existing:
            return
        admin = User(
            email=settings.ADMIN_INIT_EMAIL,
            password=hash_password(settings.ADMIN_INIT_PASSWORD),
            name=settings.ADMIN_INIT_NAME,
            role=UserRole.admin,
        )
        db.add(admin)
        db.commit()
        logger.info("Admin user created: %s", settings.ADMIN_INIT_EMAIL)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: seed admin user if needed
    seed_admin()
    # Startup: launch background auto-cancel task
    task = asyncio.create_task(auto_cancel_loop())
    yield
    # Shutdown: cancel background task
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Ad Booking Platform", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(RequestIDMiddleware)
cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Accept-Language"],
)

uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

app.include_router(auth.router)
app.include_router(spaces.router)
app.include_router(orders.router)
app.include_router(creatives.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(campaigns.router)
app.include_router(partner.router)
app.include_router(translations.router)
app.include_router(my_creatives.router)


@app.get("/")
def root():
    return {"message": "Ad Booking Platform API"}


@app.get("/settings/public")
def public_settings(db: Session = Depends(get_db)):
    from app.models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == "accent_color").first()
    return {"accent_color": row.value if row else "#e61e4d"}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db_status = "healthy"
    overall = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unhealthy"
        overall = "degraded"
    return {"status": overall, "database": db_status, "version": "1.0.0"}
