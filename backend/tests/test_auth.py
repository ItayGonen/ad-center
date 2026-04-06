def test_register(client):
    response = client.post("/auth/register", json={
        "email": "new@example.com",
        "password": "Password1!",
        "name": "New User",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "new@example.com"
    assert data["user"]["name"] == "New User"


def test_register_duplicate_email(client, test_user):
    response = client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "Password1!",
        "name": "Duplicate User",
    })
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_login(client, test_user):
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "Testpass123!",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "test@example.com"


def test_login_wrong_password(client, test_user):
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "wrongpassword",
    })
    assert response.status_code == 401
    assert "Invalid credentials" in response.json()["detail"]


def test_me_endpoint(client, test_user, auth_headers):
    response = client.get("/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert data["name"] == "Test User"


def test_me_unauthorized(client):
    response = client.get("/auth/me")
    assert response.status_code == 401
