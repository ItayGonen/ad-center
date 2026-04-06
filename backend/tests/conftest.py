from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.user import User, UserRole
from app.utils.security import hash_password, create_access_token
from app.routers.auth import limiter

SQLALCHEMY_TEST_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_TEST_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _block_emails():
    """Prevent any real emails from being sent during tests."""
    with patch("app.services.email.send_email", return_value=True), \
         patch("app.services.email.send_email_background"):
        yield


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear rate-limiter state so tests don't hit 429 from previous tests."""
    limiter.reset()
    yield


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db) -> User:
    user = User(
        email="test@example.com",
        password=hash_password("Testpass123!"),
        name="Test User",
        role=UserRole.user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def test_admin(db) -> User:
    admin = User(
        email="admin@example.com",
        password=hash_password("Adminpass123!"),
        name="Admin User",
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@pytest.fixture
def test_partner(db) -> User:
    partner = User(
        email="partner@example.com",
        password=hash_password("Partnerpass1!"),
        name="Partner User",
        role=UserRole.partner,
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return partner


@pytest.fixture
def partner_headers(test_partner) -> dict:
    token = create_access_token({"sub": str(test_partner.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers(test_user) -> dict:
    token = create_access_token({"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers(test_admin) -> dict:
    token = create_access_token({"sub": str(test_admin.id)})
    return {"Authorization": f"Bearer {token}"}
