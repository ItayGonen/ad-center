"""
Tests for the Duplicate Order to Another Space feature.

Covers: compatibility checking (full/partial/none), parent-child order relationships,
campaign grouping in listings, and creative duplication.
"""
from datetime import date, time
from app.models.space import Space, SpaceOperatingHours
from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR


# ────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────

def _create_space(db, title="Test Space", start_hour=8, end_hour=20, days=None):
    """Create a space with operating hours for given days (default all 7)."""
    space = Space(name=title, city="Tel Aviv", price_per_day=100)
    db.add(space)
    db.commit()
    db.refresh(space)
    for day in (days if days is not None else range(7)):
        db.add(SpaceOperatingHours(
            space_id=space.id,
            day_of_week=day,
            start_time=time(start_hour, 0),
            end_time=time(end_hour, 0),
        ))
    db.commit()
    return space


def _create_user_headers(client, db, email, name="User"):
    """Register a user and return (auth headers, user)."""
    from app.models.user import User, UserRole
    from app.utils.security import hash_password, create_access_token
    user = User(email=email, password=hash_password("pass123"), name=name, role=UserRole.user)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}, user


def _book_hour(client, space_id, dt, start, end, headers):
    """Create a single order for one time range. Returns response."""
    return client.post("/orders", json={
        "space_id": space_id,
        "start_date": dt,
        "end_date": dt,
        "selected_days": [{
            "date": dt,
            "time_ranges": [{"start_time": start, "end_time": end}],
        }],
    }, headers=headers)


def _book_hours(client, space_id, dt, start, end, headers, campaign_id=None):
    """Create an order with optional campaign_id. Returns response."""
    body = {
        "space_id": space_id,
        "start_date": dt,
        "end_date": dt,
        "selected_days": [{
            "date": dt,
            "time_ranges": [{"start_time": start, "end_time": end}],
        }],
    }
    if campaign_id is not None:
        body["campaign_id"] = campaign_id
    return client.post("/orders", json=body, headers=headers)


# ────────────────────────────────────────────
#  1. Compatibility — FULL
# ────────────────────────────────────────────

class TestCompatibilityFull:
    """Two spaces with same operating hours → FULL compatibility."""

    def test_full_compatibility(self, client, db, test_user, auth_headers):
        """Source order at 09–12 on space A, target space B has same hours → full."""
        space_a = _create_space(db, title="Space A")
        space_b = _create_space(db, title="Space B")

        # Create order on space A: 3 hours
        resp = _book_hour(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Check compatibility with space B
        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 3
        assert data["conflict_count"] == 0
        assert data["total_source_slots"] == 3
        assert data["target_space_id"] == space_b.id
        assert data["target_space_name"] == "Space B"

    def test_correct_estimated_cost(self, client, db, test_user, auth_headers):
        """Estimated cost uses target space pricing."""
        space_a = _create_space(db, title="Space A Cheap")
        # Space B has different pricing
        space_b = Space(name="Space B Expensive", city="Tel Aviv", price_per_day=200)
        db.add(space_b)
        db.commit()
        db.refresh(space_b)
        for day in range(7):
            db.add(SpaceOperatingHours(
                space_id=space_b.id, day_of_week=day,
                start_time=time(8, 0), end_time=time(20, 0),
            ))
        db.commit()

        resp = _book_hour(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        # prorated: 200/12 * 2 ≈ 33.33
        assert round(data["estimated_cost"], 2) == 33.33
        assert data["target_space_price_per_day"] == 200.0


# ────────────────────────────────────────────
#  2. Compatibility — PARTIAL
# ────────────────────────────────────────────

class TestCompatibilityPartial:
    """Target has narrower operating hours or some capacity-full hours."""

    def test_narrower_operating_hours(self, client, db, test_user, auth_headers):
        """Source has 08–12, target only opens 10–20 → 2 available, 2 outside hours."""
        space_a = _create_space(db, title="Space A Wide", start_hour=8, end_hour=20)
        space_b = _create_space(db, title="Space B Narrow", start_hour=10, end_hour=20)

        resp = _book_hour(client, space_a.id, "2025-07-01", "08:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 10:00, 11:00
        assert data["conflict_count"] == 2  # 08:00, 09:00

        # Check conflict reasons
        reasons = [c["reason"] for c in data["conflicts"]]
        assert all(r == "outside_operating_hours" for r in reasons)

    def test_capacity_full_conflicts(self, client, db, test_user, auth_headers):
        """Target has some hours at full capacity → partial with capacity_full conflicts."""
        space_a = _create_space(db, title="Space A Cap")
        space_b = _create_space(db, title="Space B Cap")

        # Fill space B's 09:00 hour to capacity (6 bookings)
        for i in range(MAX_SLOTS_PER_HOUR):
            h, u = _create_user_headers(client, db, f"filler{i}@test.com", f"Filler {i}")
            resp = _book_hour(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201

        # Create order on space A: 09–11 (2 hours)
        resp = _book_hour(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1  # 10:00 only
        assert data["conflict_count"] == 1  # 09:00 full

        conflicts = data["conflicts"]
        assert len(conflicts) == 1
        assert conflicts[0]["reason"] == "capacity_full"
        assert conflicts[0]["start_time"] == "09:00:00"


# ────────────────────────────────────────────
#  3. Compatibility — NONE
# ────────────────────────────────────────────

class TestCompatibilityNone:
    """Target space is completely incompatible."""

    def test_no_operating_hours_on_day(self, client, db, test_user, auth_headers):
        """Target has no operating hours on the booked day-of-week → NONE."""
        space_a = _create_space(db, title="Space A All")
        # Space B only operates on weekdays (Mon-Fri = days 1-5)
        space_b = _create_space(db, title="Space B Weekday", days=[1, 2, 3, 4, 5])

        # 2025-07-06 is a Sunday (day_of_week=0)
        resp = _book_hour(client, space_a.id, "2025-07-06", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0

    def test_all_hours_at_capacity(self, client, db, test_user, auth_headers):
        """All source hours are at capacity on target → NONE."""
        space_a = _create_space(db, title="Space A Full")
        space_b = _create_space(db, title="Space B Full")

        # Fill space B 09:00 and 10:00 to capacity
        for hour_start, hour_end in [("09:00:00", "10:00:00"), ("10:00:00", "11:00:00")]:
            for i in range(MAX_SLOTS_PER_HOUR):
                h, u = _create_user_headers(client, db, f"fill_{hour_start}_{i}@test.com")
                resp = _book_hour(client, space_b.id, "2025-07-01", hour_start, hour_end, h)
                assert resp.status_code == 201

        # Create order on space A: 09–11
        resp = _book_hour(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 2

    def test_same_space_returns_400(self, client, db, test_user, auth_headers):
        """Checking compatibility with the same space → 400."""
        space = _create_space(db, title="Same Space")

        resp = _book_hour(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp = client.get(f"/orders/{order_id}/compatibility/{space.id}", headers=auth_headers)
        assert resp.status_code == 400
        assert "same space" in resp.json()["detail"].lower()


# ────────────────────────────────────────────
#  4. Parent-Child Orders
# ────────────────────────────────────────────

class TestCampaignOrders:
    """Creating orders with campaign_id."""

    def test_create_with_campaign(self, client, db, test_user, auth_headers):
        """Create a campaign and orders linked to it → stored correctly."""
        space_a = _create_space(db, title="Space A Parent")
        space_b = _create_space(db, title="Space B Child")

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # Create primary order
        resp = _book_hours(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        primary = resp.json()
        assert primary["campaign_id"] == campaign_id

        # Create child order with campaign_id
        resp = _book_hours(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child = resp.json()
        assert child["campaign_id"] == campaign_id

    def test_campaign_from_another_user_404(self, client, db, test_user, auth_headers):
        """campaign_id pointing to another user's campaign → 404."""
        space_b = _create_space(db, title="Space B Other")

        # Create campaign as another user
        other_headers, other_user = _create_user_headers(client, db, "other@test.com", "Other User")
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=other_headers)
        assert resp.status_code == 201
        other_campaign_id = resp.json()["id"]

        # Try to create order referencing other user's campaign
        resp = _book_hours(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=other_campaign_id)
        assert resp.status_code == 404
        assert "campaign not found" in resp.json()["detail"].lower()


# ────────────────────────────────────────────
#  5. Grouped Listing
# ────────────────────────────────────────────

class TestGroupedListing:
    """Child orders are nested under primary in /orders/my response."""

    def test_child_nested_under_primary(self, client, db, test_user, auth_headers):
        """Child orders appear in primary's child_orders, not at top level."""
        space_a = _create_space(db, title="Space A Group")
        space_b = _create_space(db, title="Space B Group")

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # Create primary
        resp = _book_hours(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        primary_id = resp.json()["id"]

        # Create child
        resp = _book_hours(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child_id = resp.json()["id"]

        # Get orders
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.status_code == 200
        items = resp.json()["items"]

        # Only the primary should be at top level
        top_ids = [o["id"] for o in items]
        assert primary_id in top_ids
        assert child_id not in top_ids

        # Primary should have child_orders
        primary = next(o for o in items if o["id"] == primary_id)
        assert len(primary["child_orders"]) == 1
        assert primary["child_orders"][0]["id"] == child_id
        assert primary["child_orders"][0]["space_name"] == "Space B Group"

    def test_standalone_has_empty_child_orders(self, client, db, test_user, auth_headers):
        """Standalone orders have empty child_orders list."""
        space = _create_space(db, title="Space Standalone")

        resp = _book_hour(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201

        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["child_orders"] == []

    def test_total_count_excludes_children(self, client, db, test_user, auth_headers):
        """Total count in pagination only counts top-level orders."""
        space_a = _create_space(db, title="Space A Count")
        space_b = _create_space(db, title="Space B Count")

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # Create primary
        resp = _book_hours(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201

        # Create 2 children
        for i in range(2):
            resp = _book_hours(
                client, space_b.id, f"2025-07-0{i+2}", "09:00:00", "10:00:00",
                auth_headers, campaign_id=campaign_id,
            )
            assert resp.status_code == 201

        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1  # Only the primary
        assert len(data["items"]) == 1
        assert len(data["items"][0]["child_orders"]) == 2


# ────────────────────────────────────────────
#  6. Edit Order — Price Recalculation
# ────────────────────────────────────────────

class TestEditOrderPriceUpdate:
    """Editing an order must recalculate total_cost based on the new schedule."""

    def test_edit_increases_price_when_hours_added(self, client, db, test_user, auth_headers):
        """Create 1-hour order, edit to 3 hours → total_cost triples."""
        space = _create_space(db, title="Space Edit Price")

        # Create order with 1 hour: 09:00–10:00 → prorated: 100/12 * 1 ≈ 8.33
        resp = _book_hour(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]
        assert round(float(resp.json()["total_cost"]), 2) == 8.33

        # Edit to 3 hours: 09:00–12:00 → prorated: 100/12 * 3 = 25.0
        edit_resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-07-01",
            "end_date": "2025-07-01",
            "selected_days": [{
                "date": "2025-07-01",
                "time_ranges": [{"start_time": "09:00:00", "end_time": "12:00:00"}],
            }],
        }, headers=auth_headers)
        assert edit_resp.status_code == 200
        assert float(edit_resp.json()["total_cost"]) == 25.0

        # Verify via detail endpoint too
        detail_resp = client.get(f"/orders/{order_id}", headers=auth_headers)
        assert detail_resp.status_code == 200
        assert float(detail_resp.json()["total_cost"]) == 25.0

    def test_edit_increases_price_when_days_added(self, client, db, test_user, auth_headers):
        """Create 1-day order, edit to 2 days → total_cost doubles."""
        space = _create_space(db, title="Space Edit Days")

        # Create order: 1 day × 2 hours → prorated: 100/12 * 2 ≈ 16.67
        resp = _book_hour(client, space.id, "2025-07-01", "10:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]
        assert round(float(resp.json()["total_cost"]), 2) == 16.67

        # Edit to 2 days × 2 hours → prorated: (100/12 * 2) * 2 ≈ 33.33
        edit_resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-07-01",
            "end_date": "2025-07-02",
            "selected_days": [
                {
                    "date": "2025-07-01",
                    "time_ranges": [{"start_time": "10:00:00", "end_time": "12:00:00"}],
                },
                {
                    "date": "2025-07-02",
                    "time_ranges": [{"start_time": "10:00:00", "end_time": "12:00:00"}],
                },
            ],
        }, headers=auth_headers)
        assert edit_resp.status_code == 200
        assert round(float(edit_resp.json()["total_cost"]), 2) == 33.33

    def test_edit_price_reflected_in_my_orders_listing(self, client, db, test_user, auth_headers):
        """After editing, /orders/my returns the updated total_cost."""
        space = _create_space(db, title="Space Edit Listing")

        # Create 1 hour order
        resp = _book_hour(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Verify initial cost in listing: 100/12 * 1 ≈ 8.33
        listing = client.get("/orders/my", headers=auth_headers)
        original_cost = float(listing.json()["items"][0]["total_cost"])
        assert round(original_cost, 2) == 8.33

        # Edit to 4 hours
        client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-07-01",
            "end_date": "2025-07-01",
            "selected_days": [{
                "date": "2025-07-01",
                "time_ranges": [{"start_time": "09:00:00", "end_time": "13:00:00"}],
            }],
        }, headers=auth_headers)

        # Verify updated cost in listing: 100/12 * 4 ≈ 33.33
        listing = client.get("/orders/my", headers=auth_headers)
        updated_cost = float(listing.json()["items"][0]["total_cost"])
        assert round(updated_cost, 2) == 33.33

    def test_edit_child_order_price_reflected_in_campaign(self, client, db, test_user, auth_headers):
        """Editing a child order updates its total_cost in the campaign listing."""
        space_a = _create_space(db, title="Space A Campaign Edit")
        space_b = _create_space(db, title="Space B Campaign Edit")

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # Create primary: 1 hour = 100
        resp = _book_hours(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        primary_id = resp.json()["id"]

        # Create child: 1 hour = 100
        resp = _book_hours(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child_id = resp.json()["id"]

        # Edit child to 3 hours → prorated: 100/12 * 3 = 25.0
        edit_resp = client.put(f"/orders/{child_id}/edit", json={
            "start_date": "2025-07-01",
            "end_date": "2025-07-01",
            "selected_days": [{
                "date": "2025-07-01",
                "time_ranges": [{"start_time": "09:00:00", "end_time": "12:00:00"}],
            }],
        }, headers=auth_headers)
        assert edit_resp.status_code == 200
        assert float(edit_resp.json()["total_cost"]) == 25.0

        # Verify in listing: child's cost is updated
        listing = client.get("/orders/my", headers=auth_headers)
        items = listing.json()["items"]
        primary = next(o for o in items if o["id"] == primary_id)
        child_in_listing = next(c for c in primary["child_orders"] if c["id"] == child_id)
        assert float(child_in_listing["total_cost"]) == 25.0


# ────────────────────────────────────────────
#  7. Campaign Compatibility — exclude_order_id
# ────────────────────────────────────────────

class TestCampaignCompatibility:
    """Tests for exclude_order_id and batch campaign-compatibility endpoint."""

    def test_compatibility_exclude_order(self, client, db, test_user, auth_headers):
        """Child's own slots should be excluded from capacity count when exclude_order_id is set."""
        space_a = _create_space(db, title="Space A Excl")
        space_b = _create_space(db, title="Space B Excl")

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # Create primary order on space A: 09-11
        resp = _book_hours(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        parent_id = resp.json()["id"]

        # Create child order on space B: 09-10
        resp = _book_hours(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child_id = resp.json()["id"]

        # Fill space B's 09:00 to capacity - 1 (child already has 1 slot)
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, u = _create_user_headers(client, db, f"filler_excl_{i}@test.com", f"Filler {i}")
            resp = _book_hour(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201

        # Without exclude: 09:00 should be full (child's slot + fillers = MAX)
        resp = client.get(f"/orders/{parent_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"  # 10:00 available, 09:00 full

        # With exclude_order_id=child_id: child's slot freed, 09:00 should be available
        resp = client.get(f"/orders/{parent_id}/compatibility/{space_b.id}?exclude_order={child_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 2

    def test_campaign_compatibility_endpoint(self, client, db, test_user, auth_headers):
        """Batch campaign-compatibility returns per-target results."""
        space_a = _create_space(db, title="Space A Batch")
        space_b = _create_space(db, title="Space B Batch")
        space_c = _create_space(db, title="Space C Batch", start_hour=12, end_hour=20)

        # Create parent order on space A: 09-11
        resp = _book_hour(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        parent_id = resp.json()["id"]

        # Batch check: space B (full compat) and space C (partial - opens at 12)
        resp = client.post(f"/orders/{parent_id}/campaign-compatibility", json=[
            {"target_space_id": space_b.id},
            {"target_space_id": space_c.id},
        ], headers=auth_headers)
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 2

        # space B should be full
        assert results[0]["target_space_id"] == space_b.id
        assert results[0]["compatibility"] == "full"
        assert results[0]["available_count"] == 2

        # space C should be none (09-11 outside 12-20 hours)
        assert results[1]["target_space_id"] == space_c.id
        assert results[1]["compatibility"] == "none"
        assert results[1]["available_count"] == 0

    def test_campaign_compatibility_same_space_allowed_with_exclude(self, client, db, test_user, auth_headers):
        """Same-space check is allowed when exclude_order_id is provided (for campaign edit)."""
        space = _create_space(db, title="Space Same")

        # Create parent order: 09-10
        resp = _book_hour(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        parent_id = resp.json()["id"]

        # Create campaign and assign primary
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]
        client.put(f"/orders/{parent_id}/set-campaign", json={"campaign_id": campaign_id}, headers=auth_headers)

        # Create child order on same space: 09-10
        resp = _book_hours(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child_id = resp.json()["id"]

        # Without exclude: same space → 400
        resp = client.get(f"/orders/{parent_id}/compatibility/{space.id}", headers=auth_headers)
        assert resp.status_code == 400

        # With exclude: same space → allowed
        resp = client.get(f"/orders/{parent_id}/compatibility/{space.id}?exclude_order={child_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["target_space_id"] == space.id
