def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "database" in data
    assert "version" in data
    assert data["version"] == "1.0.0"


def test_health_db_healthy(client):
    response = client.get("/health")
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "healthy"
