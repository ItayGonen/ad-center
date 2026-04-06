from app.models.space import Space, AudienceProfile, AudienceCategory, SpaceType


def _seed_profiles(db):
    """Insert a few audience profiles for testing."""
    profiles = [
        AudienceProfile(name="Women", category=AudienceCategory.demographic),
        AudienceProfile(name="Men", category=AudienceCategory.demographic),
        AudienceProfile(name="Fitness & Sports", category=AudienceCategory.lifestyle),
        AudienceProfile(name="Commuters", category=AudienceCategory.behavior),
    ]
    db.add_all(profiles)
    db.commit()
    for p in profiles:
        db.refresh(p)
    return profiles


def _seed_space_types(db):
    """Insert a few space types for testing."""
    types = [
        SpaceType(name="Gym"),
        SpaceType(name="Restaurant"),
        SpaceType(name="Cafe"),
    ]
    db.add_all(types)
    db.commit()
    for t in types:
        db.refresh(t)
    return types


def test_list_spaces_empty(client):
    response = client.get("/spaces")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1


def test_list_spaces_with_data(client, db):
    space = Space(
        name="Test Space",
        city="Tel Aviv",
        price_per_day=100,
    )
    db.add(space)
    db.commit()

    response = client.get("/spaces")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Test Space"


def test_space_detail(client, db):
    space = Space(
        name="Detail Space",
        city="Haifa",
        price_per_day=50,
    )
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.get(f"/spaces/{space.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Detail Space"


def test_space_not_found(client):
    response = client.get("/spaces/9999")
    assert response.status_code == 404


def test_list_audience_profiles(client, db):
    profiles = _seed_profiles(db)
    response = client.get("/spaces/audience-profiles")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 4
    names = {p["name"] for p in data}
    assert "Women" in names
    assert "Commuters" in names


def test_create_space_with_audience_profiles(client, db, admin_headers):
    profiles = _seed_profiles(db)
    payload = {
        "name": "Space With Audience",
        "city": "Tel Aviv",
        "price_per_day": 100,
        "audience_profile_ids": [profiles[0].id, profiles[2].id],
    }
    response = client.post("/admin/spaces", json=payload, headers=admin_headers)
    assert response.status_code == 201
    data = response.json()
    ap_names = {ap["name"] for ap in data["audience_profiles"]}
    assert "Women" in ap_names
    assert "Fitness & Sports" in ap_names
    assert len(data["audience_profiles"]) == 2


def test_update_space_audience_profiles(client, db, admin_headers):
    profiles = _seed_profiles(db)
    space = Space(name="Update AP Space", city="Haifa", price_per_day=50)
    space.audience_profiles = [profiles[0]]
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.put(
        f"/admin/spaces/{space.id}",
        json={"audience_profile_ids": [profiles[1].id, profiles[3].id]},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    ap_names = {ap["name"] for ap in data["audience_profiles"]}
    assert ap_names == {"Men", "Commuters"}


def test_clear_audience_profiles(client, db, admin_headers):
    profiles = _seed_profiles(db)
    space = Space(name="Clear AP Space", city="Haifa", price_per_day=50)
    space.audience_profiles = [profiles[0], profiles[1]]
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.put(
        f"/admin/spaces/{space.id}",
        json={"audience_profile_ids": []},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["audience_profiles"] == []


def test_filter_spaces_by_audience(client, db):
    profiles = _seed_profiles(db)
    space1 = Space(name="Space A", city="Tel Aviv", price_per_day=100)
    space1.audience_profiles = [profiles[0]]
    space2 = Space(name="Space B", city="Tel Aviv", price_per_day=200)
    space2.audience_profiles = [profiles[1]]
    space3 = Space(name="Space C", city="Tel Aviv", price_per_day=150)
    # No audience profiles
    db.add_all([space1, space2, space3])
    db.commit()

    # Filter by Women (profiles[0])
    response = client.get(f"/spaces?audience_profile_ids={profiles[0].id}")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Space A"

    # Filter by Women OR Men
    response = client.get(f"/spaces?audience_profile_ids={profiles[0].id},{profiles[1].id}")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2


def test_space_detail_includes_audience_profiles(client, db):
    profiles = _seed_profiles(db)
    space = Space(name="Detail AP Space", city="Haifa", price_per_day=50)
    space.audience_profiles = [profiles[0], profiles[2]]
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.get(f"/spaces/{space.id}")
    assert response.status_code == 200
    data = response.json()
    assert len(data["audience_profiles"]) == 2
    ap_names = {ap["name"] for ap in data["audience_profiles"]}
    assert "Women" in ap_names
    assert "Fitness & Sports" in ap_names


# ── Space Type Tests ──


def test_list_space_types(client, db):
    _seed_space_types(db)
    response = client.get("/spaces/space-types")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 3
    names = {t["name"] for t in data}
    assert "Gym" in names
    assert "Restaurant" in names


def test_create_space_with_space_type(client, db, admin_headers):
    types = _seed_space_types(db)
    payload = {
        "name": "Typed Space",
        "city": "Tel Aviv",
        "price_per_day": 100,
        "space_type_id": types[0].id,
    }
    response = client.post("/admin/spaces", json=payload, headers=admin_headers)
    assert response.status_code == 201
    data = response.json()
    assert data["space_type"]["id"] == types[0].id
    assert data["space_type"]["name"] == "Gym"


def test_create_space_with_invalid_space_type(client, db, admin_headers):
    payload = {
        "name": "Bad Type Space",
        "city": "Tel Aviv",
        "price_per_day": 100,
        "space_type_id": 9999,
    }
    response = client.post("/admin/spaces", json=payload, headers=admin_headers)
    assert response.status_code == 400
    assert "Invalid space_type_id" in response.json()["detail"]


def test_update_space_type(client, db, admin_headers):
    types = _seed_space_types(db)
    space = Space(name="Update Type Space", city="Haifa", price_per_day=50, space_type_id=types[0].id)
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.put(
        f"/admin/spaces/{space.id}",
        json={"space_type_id": types[1].id},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["space_type"]["name"] == "Restaurant"


def test_update_space_invalid_space_type(client, db, admin_headers):
    types = _seed_space_types(db)
    space = Space(name="Invalid Update Space", city="Haifa", price_per_day=50, space_type_id=types[0].id)
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.put(
        f"/admin/spaces/{space.id}",
        json={"space_type_id": 9999},
        headers=admin_headers,
    )
    assert response.status_code == 400


def test_space_detail_includes_space_type(client, db):
    types = _seed_space_types(db)
    space = Space(name="Detail Type Space", city="Haifa", price_per_day=50, space_type_id=types[2].id)
    db.add(space)
    db.commit()
    db.refresh(space)

    response = client.get(f"/spaces/{space.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["space_type"]["name"] == "Cafe"


def test_space_list_includes_space_type(client, db):
    types = _seed_space_types(db)
    space = Space(name="List Type Space", city="Tel Aviv", price_per_day=75, space_type_id=types[1].id)
    db.add(space)
    db.commit()

    response = client.get("/spaces")
    assert response.status_code == 200
    data = response.json()
    assert data["items"][0]["space_type"]["name"] == "Restaurant"
