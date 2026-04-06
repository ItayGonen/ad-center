"""
Tests for Campaign logic — both creation flows and all edge cases.

Flow 1: Booking Flow → Add More Spaces
  User books a space (order created), then at step 4 optionally adds more spaces
  → creates campaign, assigns existing order, creates child orders.

Flow 2: Create Campaign (deferred order creation)
  User selects spaces in CreateCampaign page, configures schedule, reviews compatibility
  using schedule-based endpoint (no order in DB yet), then clicks "Create Campaign"
  → creates campaign, creates reference order + child orders all at once.

Covers:
  - Schedule-based compatibility (POST /orders/check-schedule-compatibility)
  - Order-based compatibility (GET /orders/{id}/compatibility/{target})
  - Campaign CRUD (create, list, detail, delete)
  - Full campaign lifecycle for both flows
  - Edge cases: capacity, operating hours, multi-day, multi-space, auth, validation
"""
from datetime import date, time
from app.models.space import Space, SpaceOperatingHours
from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR


# ────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────

def _create_space(db, title="Test Space", start_hour=8, end_hour=20, days=None, price=100):
    """Create a space with operating hours for given days (default all 7)."""
    space = Space(name=title, city="Tel Aviv", price_per_day=price)
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
    """Register a user and return (auth_headers, user)."""
    from app.models.user import User, UserRole
    from app.utils.security import hash_password, create_access_token
    user = User(email=email, password=hash_password("pass123"), name=name, role=UserRole.user)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}, user


def _book(client, space_id, dt, start, end, headers, campaign_id=None):
    """Create a single order. Returns response."""
    body = {
        "space_id": space_id,
        "start_date": dt,
        "end_date": dt,
        "selected_days": [{"date": dt, "time_ranges": [{"start_time": start, "end_time": end}]}],
    }
    if campaign_id is not None:
        body["campaign_id"] = campaign_id
    return client.post("/orders", json=body, headers=headers)


def _book_multiday(client, space_id, days_data, headers, campaign_id=None):
    """Create a multi-day order. days_data: list of (date_str, start, end).
    Returns response."""
    dates = sorted(set(d[0] for d in days_data))
    selected_days = []
    for dt in dates:
        ranges = [{"start_time": s, "end_time": e} for (d, s, e) in days_data if d == dt]
        selected_days.append({"date": dt, "time_ranges": ranges})
    body = {
        "space_id": space_id,
        "start_date": dates[0],
        "end_date": dates[-1],
        "selected_days": selected_days,
    }
    if campaign_id is not None:
        body["campaign_id"] = campaign_id
    return client.post("/orders", json=body, headers=headers)


def _schedule_compat(client, target_space_id, slots, headers):
    """Call the schedule-based compatibility endpoint. Returns response."""
    return client.post("/orders/check-schedule-compatibility", json={
        "target_space_id": target_space_id,
        "slots": slots,
    }, headers=headers)


def _make_slots(date_str, start_hour, end_hour):
    """Generate hourly slot dicts for a date range."""
    slots = []
    for h in range(start_hour, end_hour):
        slots.append({
            "date": date_str,
            "start_time": f"{h:02d}:00:00",
            "end_time": f"{h+1:02d}:00:00",
        })
    return slots


# ════════════════════════════════════════════
#  PART 1: Schedule-Based Compatibility
#          (used by Create Campaign flow)
# ════════════════════════════════════════════

class TestScheduleCompatibilityFull:
    """Schedule slots fully compatible with target space."""

    def test_full_single_hour(self, client, db, test_user, auth_headers):
        """One slot within operating hours → full compatibility."""
        space = _create_space(db, title="Target Full 1h")
        slots = _make_slots("2025-07-01", 9, 10)  # 1 hour

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 1
        assert data["conflict_count"] == 0
        assert data["total_source_slots"] == 1
        assert data["target_space_id"] == space.id
        assert data["target_space_name"] == "Target Full 1h"

    def test_full_multiple_hours(self, client, db, test_user, auth_headers):
        """Multiple hours all within operating hours → full."""
        space = _create_space(db, title="Target Full Multi")
        slots = _make_slots("2025-07-01", 9, 14)  # 5 hours

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 5
        assert data["conflict_count"] == 0

    def test_full_multiday(self, client, db, test_user, auth_headers):
        """Slots across multiple days, all within operating hours → full."""
        space = _create_space(db, title="Target Full Days")
        # 2025-07-01 (Tue) and 2025-07-02 (Wed) — both weekdays
        slots = _make_slots("2025-07-01", 10, 12) + _make_slots("2025-07-02", 10, 12)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 4
        assert data["total_source_slots"] == 4

    def test_estimated_cost_uses_target_price(self, client, db, test_user, auth_headers):
        """Estimated cost reflects the target space's price_per_day."""
        space = _create_space(db, title="Expensive Target", price=250)
        slots = _make_slots("2025-07-01", 9, 12)  # 3 hours

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        # prorated: 250/12 * 3 = 62.5
        assert data["estimated_cost"] == 62.5
        assert data["target_space_price_per_day"] == 250.0


class TestScheduleCompatibilityPartial:
    """Some slots conflict but others are available."""

    def test_narrower_operating_hours(self, client, db, test_user, auth_headers):
        """Target opens at 10, schedule starts at 08 → partial."""
        space = _create_space(db, title="Narrow Target", start_hour=10, end_hour=20)
        slots = _make_slots("2025-07-01", 8, 12)  # 08,09,10,11

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 10:00, 11:00
        assert data["conflict_count"] == 2  # 08:00, 09:00
        reasons = [c["reason"] for c in data["conflicts"]]
        assert all(r == "outside_operating_hours" for r in reasons)

    def test_some_hours_at_capacity(self, client, db, test_user, auth_headers):
        """Target has 09:00 at full capacity → partial."""
        space = _create_space(db, title="Partial Cap Target")

        # Fill 09:00 to capacity on target
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"sched_fill_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201

        slots = _make_slots("2025-07-01", 9, 11)  # 09:00, 10:00

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1  # 10:00
        assert data["conflict_count"] == 1  # 09:00 full
        assert data["conflicts"][0]["reason"] == "capacity_full"
        assert data["conflicts"][0]["start_time"] == "09:00:00"

    def test_mixed_operating_hours_and_capacity(self, client, db, test_user, auth_headers):
        """Some hours outside OH, some at capacity, some available → partial with mixed reasons."""
        space = _create_space(db, title="Mixed Target", start_hour=10, end_hour=18)

        # Fill 10:00 on target
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"mixed_fill_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)
            assert resp.status_code == 201

        # Schedule: 09(outside), 10(full), 11(ok), 12(ok)
        slots = _make_slots("2025-07-01", 9, 13)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 11:00, 12:00
        assert data["conflict_count"] == 2  # 09:00 outside, 10:00 full
        reasons = sorted([c["reason"] for c in data["conflicts"]])
        assert "capacity_full" in reasons
        assert "outside_operating_hours" in reasons


class TestScheduleCompatibilityNone:
    """All slots conflict → none."""

    def test_no_operating_hours_on_day(self, client, db, test_user, auth_headers):
        """Target only operates weekdays, schedule is on Sunday → none."""
        # 2025-07-06 is a Sunday (dow=0)
        space = _create_space(db, title="Weekday Only", days=[1, 2, 3, 4, 5])
        slots = _make_slots("2025-07-06", 9, 11)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 2

    def test_all_hours_at_capacity(self, client, db, test_user, auth_headers):
        """All scheduled hours are at capacity on target → none."""
        space = _create_space(db, title="Full Cap Target")

        for hour_start in range(9, 11):
            for i in range(MAX_SLOTS_PER_HOUR):
                h, _ = _create_user_headers(client, db, f"cap_none_{hour_start}_{i}@test.com")
                resp = _book(client, space.id, "2025-07-01",
                             f"{hour_start:02d}:00:00", f"{hour_start+1:02d}:00:00", h)
                assert resp.status_code == 201

        slots = _make_slots("2025-07-01", 9, 11)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["estimated_cost"] == 0.0

    def test_all_outside_operating_hours(self, client, db, test_user, auth_headers):
        """Schedule entirely outside target operating hours → none."""
        space = _create_space(db, title="Afternoon Target", start_hour=14, end_hour=20)
        slots = _make_slots("2025-07-01", 8, 12)  # all morning

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert all(c["reason"] == "outside_operating_hours" for c in data["conflicts"])


class TestScheduleCompatibilityValidation:
    """Validation and error handling for the schedule-based endpoint."""

    def test_empty_slots_returns_400(self, client, db, test_user, auth_headers):
        """Empty slots list → 400."""
        space = _create_space(db, title="Empty Slot Target")

        resp = _schedule_compat(client, space.id, [], auth_headers)
        assert resp.status_code == 400
        assert "no schedule slots" in resp.json()["detail"].lower()

    def test_nonexistent_space_returns_404(self, client, db, test_user, auth_headers):
        """Target space doesn't exist → 404."""
        slots = _make_slots("2025-07-01", 9, 10)

        resp = _schedule_compat(client, 99999, slots, auth_headers)
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_requires_authentication(self, client, db):
        """No auth header → 401."""
        space = _create_space(db, title="Auth Target")
        slots = _make_slots("2025-07-01", 9, 10)

        resp = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space.id,
            "slots": slots,
        })
        assert resp.status_code == 401

    def test_space_with_no_operating_hours_all_conflicts(self, client, db, test_user, auth_headers):
        """Space has no operating hours at all → all slots conflict."""
        space = Space(name="No OH Space", city="Tel Aviv", price_per_day=100)
        db.add(space)
        db.commit()
        db.refresh(space)
        # No operating hours added

        slots = _make_slots("2025-07-01", 9, 11)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["conflict_count"] == 2
        assert all(c["reason"] == "outside_operating_hours" for c in data["conflicts"])


class TestScheduleCompatibilityConsistency:
    """Schedule-based and order-based compatibility should give the same results."""

    def test_same_result_as_order_based(self, client, db, test_user, auth_headers):
        """Given identical slots, both endpoints should return matching results."""
        space_a = _create_space(db, title="Source Consist")
        space_b = _create_space(db, title="Target Consist", start_hour=10, end_hour=18)

        # Create order on space A: 09–13 (4 hours)
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "13:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Order-based check
        resp1 = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp1.status_code == 200
        data1 = resp1.json()

        # Schedule-based check with same slots
        slots = _make_slots("2025-07-01", 9, 13)
        resp2 = _schedule_compat(client, space_b.id, slots, auth_headers)
        assert resp2.status_code == 200
        data2 = resp2.json()

        # Core results should match
        assert data1["compatibility"] == data2["compatibility"]
        assert data1["available_count"] == data2["available_count"]
        assert data1["conflict_count"] == data2["conflict_count"]
        assert data1["estimated_cost"] == data2["estimated_cost"]
        assert data1["total_source_slots"] == data2["total_source_slots"]


# ════════════════════════════════════════════
#  PART 2: Campaign CRUD
# ════════════════════════════════════════════

class TestCampaignCRUD:
    """Basic campaign create, list, detail, delete."""

    def test_create_campaign(self, client, db, test_user, auth_headers):
        """Create a long_term campaign."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["campaign_type"] == "long_term"
        assert data["status"] == "active"
        assert "id" in data

    def test_create_long_term_campaign(self, client, db, test_user, auth_headers):
        """Create a long_term campaign (explicit type)."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["campaign_type"] == "long_term"

    def test_list_my_campaigns(self, client, db, test_user, auth_headers):
        """User can list their own campaigns."""
        client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)

        resp = client.get("/campaigns/my", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_campaign_detail(self, client, db, test_user, auth_headers):
        """Fetch campaign detail by ID."""
        create_resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = create_resp.json()["id"]

        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == cid

    def test_cancel_campaign(self, client, db, test_user, auth_headers):
        """Cancel own campaign."""
        create_resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = create_resp.json()["id"]

        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Should still be in list but with cancelled status
        resp = client.get("/campaigns/my", headers=auth_headers)
        assert len(resp.json()) == 1
        assert resp.json()[0]["status"] == "cancelled"

    def test_cancel_already_cancelled_fails(self, client, db, test_user, auth_headers):
        """Cancelling an already cancelled campaign returns 400."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = resp.json()["id"]
        client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)

        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code == 400

    def test_cancel_others_campaign_fails(self, client, db, test_user, auth_headers):
        """Cannot cancel another user's campaign."""
        other_headers, _ = _create_user_headers(client, db, "other_del@test.com")
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=other_headers)
        cid = resp.json()["id"]

        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code in (403, 404)

    def test_campaign_requires_auth(self, client, db):
        """Campaign endpoints require authentication."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"})
        assert resp.status_code == 401

        resp = client.get("/campaigns/my")
        assert resp.status_code == 401


# ════════════════════════════════════════════
#  PART 3: Flow 1 — Booking Flow → Add More Spaces
#          (order created first, then campaign)
# ════════════════════════════════════════════

class TestFlow1BookingThenCampaign:
    """User books a space, then adds more spaces to create a campaign."""

    def test_full_flow_single_child(self, client, db, test_user, auth_headers):
        """Book space A → create campaign → assign order → add child on space B."""
        space_a = _create_space(db, title="Flow1 A")
        space_b = _create_space(db, title="Flow1 B")

        # 1. Book space A
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_a = resp.json()
        order_a_id = order_a["id"]

        # 2. Check compatibility with space B
        resp = client.get(f"/orders/{order_a_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "full"

        # 3. Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        campaign_id = resp.json()["id"]

        # 4. Assign reference order to campaign
        resp = client.put(f"/orders/{order_a_id}/set-campaign",
                          json={"campaign_id": campaign_id}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["campaign_id"] == campaign_id

        # 5. Create child order on space B
        resp = _book(client, space_b.id, "2025-07-01", "09:00:00", "12:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        child = resp.json()
        assert child["campaign_id"] == campaign_id

        # 6. Verify listing: primary has child nested
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        primary = next(o for o in items if o["id"] == order_a_id)
        assert len(primary["child_orders"]) == 1
        assert primary["child_orders"][0]["id"] == child["id"]

    def test_full_flow_multiple_children(self, client, db, test_user, auth_headers):
        """Book space A → add spaces B and C as children."""
        space_a = _create_space(db, title="Flow1 Multi A")
        space_b = _create_space(db, title="Flow1 Multi B")
        space_c = _create_space(db, title="Flow1 Multi C", price=200)

        resp = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00", auth_headers)
        order_a_id = resp.json()["id"]

        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]
        client.put(f"/orders/{order_a_id}/set-campaign",
                   json={"campaign_id": campaign_id}, headers=auth_headers)

        # Add children
        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_c = _book(client, space_c.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        assert resp_b.status_code == 201
        assert resp_c.status_code == 201

        # Verify listing
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        primary = next(o for o in items if o["id"] == order_a_id)
        assert len(primary["child_orders"]) == 2

    def test_child_order_uses_partial_slots(self, client, db, test_user, auth_headers):
        """Child can be created with only the compatible subset of hours."""
        space_a = _create_space(db, title="Flow1 Partial A", start_hour=8, end_hour=20)
        space_b = _create_space(db, title="Flow1 Partial B", start_hour=10, end_hour=18)

        # Book 08-14 on space A (6 hours)
        resp = _book(client, space_a.id, "2025-07-01", "08:00:00", "14:00:00", auth_headers)
        order_a_id = resp.json()["id"]

        # Check compatibility: only 10-14 available (4 hours)
        resp = client.get(f"/orders/{order_a_id}/compatibility/{space_b.id}", headers=auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 4

        # Create campaign and child with available hours only
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]
        client.put(f"/orders/{order_a_id}/set-campaign",
                   json={"campaign_id": campaign_id}, headers=auth_headers)

        resp = _book(client, space_b.id, "2025-07-01", "10:00:00", "14:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        # prorated: 100/8 * 4 = 50.0 (space_b ops: 10-18 = 8h)
        assert float(resp.json()["total_cost"]) == 50.0


# ════════════════════════════════════════════
#  PART 4: Flow 2 — Create Campaign (deferred order)
#          Uses schedule-based compatibility
# ════════════════════════════════════════════

class TestFlow2CreateCampaignDirect:
    """User picks spaces first, configures schedule, checks compatibility
    via schedule endpoint, then creates campaign + all orders at once."""

    def test_full_flow_all_compatible(self, client, db, test_user, auth_headers):
        """3 spaces, all fully compatible → create campaign with 3 orders."""
        space_a = _create_space(db, title="Direct A")
        space_b = _create_space(db, title="Direct B")
        space_c = _create_space(db, title="Direct C")

        slots = _make_slots("2025-07-01", 9, 12)  # 3 hours

        # Check all targets with schedule-based endpoint (no order exists yet)
        for sp in [space_b, space_c]:
            resp = _schedule_compat(client, sp.id, slots, auth_headers)
            assert resp.status_code == 200
            assert resp.json()["compatibility"] == "full"

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        # Create reference order with campaign_id
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        ref_order_id = resp.json()["id"]

        # Create child orders
        for sp in [space_b, space_c]:
            resp = _book(client, sp.id, "2025-07-01", "09:00:00", "12:00:00",
                         auth_headers, campaign_id=campaign_id)
            assert resp.status_code == 201

        # Verify listing
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        assert len(items) == 1  # only primary at top level
        primary = items[0]
        assert primary["id"] == ref_order_id
        assert len(primary["child_orders"]) == 2

    def test_flow_with_partial_compatibility(self, client, db, test_user, auth_headers):
        """One target is partial → user can still include it."""
        space_a = _create_space(db, title="Direct Partial A")
        space_b = _create_space(db, title="Direct Partial B", start_hour=10, end_hour=18)

        slots = _make_slots("2025-07-01", 8, 12)  # 4 hours

        resp = _schedule_compat(client, space_b.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 10, 11

        # Create campaign with partial child
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        _book(client, space_a.id, "2025-07-01", "08:00:00", "12:00:00",
              auth_headers, campaign_id=campaign_id)
        resp = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        # prorated: 100/8 * 2 = 25.0 (space_b ops: 10-18 = 8h)
        assert float(resp.json()["total_cost"]) == 25.0

    def test_flow_skip_none_compatibility_space(self, client, db, test_user, auth_headers):
        """Space with none compatibility is excluded from campaign, others included."""
        space_a = _create_space(db, title="Direct Skip A")
        space_good = _create_space(db, title="Direct Skip Good")
        space_bad = _create_space(db, title="Direct Skip Bad", days=[1, 2, 3, 4, 5])  # weekday only

        # 2025-07-06 is Sunday
        slots = _make_slots("2025-07-06", 9, 11)

        resp_good = _schedule_compat(client, space_good.id, slots, auth_headers)
        assert resp_good.json()["compatibility"] == "full"

        resp_bad = _schedule_compat(client, space_bad.id, slots, auth_headers)
        assert resp_bad.json()["compatibility"] == "none"

        # Create campaign, skip the bad space
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        _book(client, space_a.id, "2025-07-06", "09:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)
        resp = _book(client, space_good.id, "2025-07-06", "09:00:00", "11:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201

        # Campaign has 1 child
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        assert len(items[0]["child_orders"]) == 1

    def test_no_order_in_db_before_campaign_created(self, client, db, test_user, auth_headers):
        """Schedule-based compatibility should NOT create any order in the DB."""
        space = _create_space(db, title="No Order Space")
        slots = _make_slots("2025-07-01", 9, 10)

        # Check compatibility — this should NOT create an order
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200

        # Verify no orders exist
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 0


# ════════════════════════════════════════════
#  PART 5: Multi-Day / Long-Term Campaign Edge Cases
# ════════════════════════════════════════════

class TestMultiDayCampaign:
    """Campaign with long-term multi-day schedules."""

    def test_multiday_schedule_compatibility(self, client, db, test_user, auth_headers):
        """Multi-day schedule checked against target that has different hours on different days."""
        # Target operates Mon-Fri only (days 1-5), 10-16
        space = _create_space(db, title="Weekday Target", days=[1, 2, 3, 4, 5],
                              start_hour=10, end_hour=16)

        # Schedule: Mon 2025-06-30 and Tue 2025-07-01 and Sun 2025-07-06
        slots = (
            _make_slots("2025-06-30", 10, 14) +  # Mon → ok
            _make_slots("2025-07-01", 10, 14) +  # Tue → ok
            _make_slots("2025-07-06", 10, 14)    # Sun → conflict
        )

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 8   # 4+4 (Mon+Tue)
        assert data["conflict_count"] == 4    # 4 (Sun)

    def test_multiday_full_campaign_lifecycle(self, client, db, test_user, auth_headers):
        """Create campaign with 2 spaces across 3 days."""
        space_a = _create_space(db, title="LT Camp A")
        space_b = _create_space(db, title="LT Camp B")

        days_data = [
            ("2025-07-01", "10:00:00", "13:00:00"),
            ("2025-07-02", "10:00:00", "13:00:00"),
            ("2025-07-03", "10:00:00", "13:00:00"),
        ]

        # Schedule-based check for space B
        slots = []
        for dt, _, _ in days_data:
            slots += _make_slots(dt, 10, 13)
        resp = _schedule_compat(client, space_b.id, slots, auth_headers)
        assert resp.json()["compatibility"] == "full"
        assert resp.json()["available_count"] == 9  # 3 hours * 3 days

        # Create campaign
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        # Create reference order (multi-day)
        resp = _book_multiday(client, space_a.id, days_data, auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201

        # Create child order
        resp = _book_multiday(client, space_b.id, days_data, auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201

        # Verify
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        assert len(items) == 1
        assert len(items[0]["child_orders"]) == 1


# ════════════════════════════════════════════
#  PART 6: Capacity Edge Cases
# ════════════════════════════════════════════

class TestCapacityEdgeCases:
    """Capacity interactions between schedule-based checks and real bookings."""

    def test_capacity_5_of_6_still_available(self, client, db, test_user, auth_headers):
        """5 bookings on a slot → still available (max is 6)."""
        space = _create_space(db, title="Cap 5of6")

        for i in range(5):
            h, _ = _create_user_headers(client, db, f"cap5_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        slots = _make_slots("2025-07-01", 9, 10)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "full"
        assert resp.json()["available_count"] == 1

    def test_capacity_exactly_6_is_full(self, client, db, test_user, auth_headers):
        """6 bookings on a slot → capacity full."""
        space = _create_space(db, title="Cap 6of6")

        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"cap6_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        slots = _make_slots("2025-07-01", 9, 10)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "none"
        assert resp.json()["conflicts"][0]["reason"] == "capacity_full"

    def test_cancelled_slots_dont_count(self, client, db, test_user, auth_headers):
        """Cancelled orders don't consume capacity."""
        space = _create_space(db, title="Cap Cancel")

        # Fill to capacity, keeping the first user's headers for cancelling
        first_user_headers = None
        first_order_id = None
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"cap_cancel_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201
            if i == 0:
                first_user_headers = h
                first_order_id = resp.json()["id"]

        # Cancel one order using the user who created it
        resp = client.put(f"/orders/{first_order_id}/cancel", headers=first_user_headers)
        assert resp.status_code == 200

        # Now should be available (5 of 6 booked)
        slots = _make_slots("2025-07-01", 9, 10)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "full"

    def test_different_dates_independent_capacity(self, client, db, test_user, auth_headers):
        """Capacity is per-date. Full on day 1, empty on day 2."""
        space = _create_space(db, title="Cap Dates")

        # Fill day 1 at 09:00
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"capd_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        # Day 1 full, day 2 empty
        slots = _make_slots("2025-07-01", 9, 10) + _make_slots("2025-07-02", 9, 10)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1   # day 2 only
        assert data["conflict_count"] == 1    # day 1 full


# ════════════════════════════════════════════
#  PART 7: Set-Campaign & Cross-User Isolation
# ════════════════════════════════════════════

class TestSetOrderCampaign:
    """Assigning orders to campaigns."""

    def test_set_campaign_on_existing_order(self, client, db, test_user, auth_headers):
        """Assign an existing standalone order to a campaign."""
        space = _create_space(db, title="Set Camp Space")
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        order_id = resp.json()["id"]
        assert resp.json()["campaign_id"] is None

        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        resp = client.put(f"/orders/{order_id}/set-campaign",
                          json={"campaign_id": campaign_id}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["campaign_id"] == campaign_id

    def test_cannot_set_others_campaign(self, client, db, test_user, auth_headers):
        """Cannot assign order to another user's campaign."""
        space = _create_space(db, title="Cross User Space")
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        order_id = resp.json()["id"]

        other_headers, _ = _create_user_headers(client, db, "other_camp@test.com")
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=other_headers)
        other_campaign_id = resp.json()["id"]

        resp = client.put(f"/orders/{order_id}/set-campaign",
                          json={"campaign_id": other_campaign_id}, headers=auth_headers)
        assert resp.status_code in (403, 404)

    def test_create_order_with_others_campaign_fails(self, client, db, test_user, auth_headers):
        """Cannot create order referencing another user's campaign_id."""
        space = _create_space(db, title="Cross Create Space")

        other_headers, _ = _create_user_headers(client, db, "other_create@test.com")
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=other_headers)
        other_campaign_id = resp.json()["id"]

        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00",
                     auth_headers, campaign_id=other_campaign_id)
        assert resp.status_code in (403, 404)


class TestCrossUserIsolation:
    """Users can't see or interact with other users' data."""

    def test_user_cannot_see_others_orders(self, client, db, test_user, auth_headers):
        """Orders listing only shows the requesting user's orders."""
        space = _create_space(db, title="Isolation Space")

        other_headers, _ = _create_user_headers(client, db, "iso_other@test.com")
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", other_headers)

        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 0

    def test_user_cannot_check_compatibility_on_others_order(self, client, db, test_user, auth_headers):
        """Cannot use another user's order for compatibility check."""
        space_a = _create_space(db, title="Iso Compat A")
        space_b = _create_space(db, title="Iso Compat B")

        other_headers, _ = _create_user_headers(client, db, "iso_compat@test.com")
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", other_headers)
        other_order_id = resp.json()["id"]

        resp = client.get(f"/orders/{other_order_id}/compatibility/{space_b.id}", headers=auth_headers)
        assert resp.status_code == 404

    def test_schedule_compat_independent_per_user(self, client, db, test_user, auth_headers):
        """Two different users can both check schedule compatibility."""
        space = _create_space(db, title="Iso Sched Space")
        slots = _make_slots("2025-07-01", 9, 10)

        other_headers, _ = _create_user_headers(client, db, "iso_sched@test.com")

        resp1 = _schedule_compat(client, space.id, slots, auth_headers)
        resp2 = _schedule_compat(client, space.id, slots, other_headers)
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["compatibility"] == resp2.json()["compatibility"]


# ════════════════════════════════════════════
#  PART 8: Operating Hours Edge Cases
# ════════════════════════════════════════════

class TestOperatingHoursEdgeCases:
    """Edge cases with operating hours boundaries."""

    def test_slot_exactly_at_boundary(self, client, db, test_user, auth_headers):
        """Slot at exact start/end of operating hours → available."""
        space = _create_space(db, title="Boundary Space", start_hour=9, end_hour=17)
        # First available hour: 09:00-10:00, last: 16:00-17:00
        slots = [
            {"date": "2025-07-01", "start_time": "09:00:00", "end_time": "10:00:00"},
            {"date": "2025-07-01", "start_time": "16:00:00", "end_time": "17:00:00"},
        ]

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "full"
        assert resp.json()["available_count"] == 2

    def test_slot_one_minute_before_open(self, client, db, test_user, auth_headers):
        """Slot starting before operating hours opens → conflict."""
        space = _create_space(db, title="Early Slot Space", start_hour=10, end_hour=18)
        slots = [{"date": "2025-07-01", "start_time": "09:00:00", "end_time": "10:00:00"}]

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "none"
        assert resp.json()["conflicts"][0]["reason"] == "outside_operating_hours"

    def test_slot_ending_after_close(self, client, db, test_user, auth_headers):
        """Slot ending after operating hours close → conflict."""
        space = _create_space(db, title="Late Slot Space", start_hour=8, end_hour=17)
        slots = [{"date": "2025-07-01", "start_time": "17:00:00", "end_time": "18:00:00"}]

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["compatibility"] == "none"
        assert resp.json()["conflicts"][0]["reason"] == "outside_operating_hours"

    def test_different_hours_per_weekday(self, client, db, test_user, auth_headers):
        """Space with different operating hours on different days."""
        space = Space(name="Varied OH", city="Tel Aviv", price_per_day=100)
        db.add(space)
        db.commit()
        db.refresh(space)
        # Monday (day=1): 08-20, Tuesday (day=2): 12-18
        db.add(SpaceOperatingHours(space_id=space.id, day_of_week=1,
                                   start_time=time(8, 0), end_time=time(20, 0)))
        db.add(SpaceOperatingHours(space_id=space.id, day_of_week=2,
                                   start_time=time(12, 0), end_time=time(18, 0)))
        db.commit()

        # Mon 2025-06-30, Tue 2025-07-01 — check 09:00-10:00 on both
        slots = [
            {"date": "2025-06-30", "start_time": "09:00:00", "end_time": "10:00:00"},  # Mon → ok
            {"date": "2025-07-01", "start_time": "09:00:00", "end_time": "10:00:00"},  # Tue → outside
        ]

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1
        assert data["conflict_count"] == 1


# ════════════════════════════════════════════
#  PART 9: Campaign with Mixed Compatibility Across Spaces
# ════════════════════════════════════════════

class TestMixedCampaign:
    """Campaign where spaces have varying compatibility levels."""

    def test_three_spaces_full_partial_none(self, client, db, test_user, auth_headers):
        """3 target spaces: full, partial, none — verify each independently."""
        space_full = _create_space(db, title="Full Compat", start_hour=8, end_hour=20)
        space_partial = _create_space(db, title="Partial Compat", start_hour=10, end_hour=20)
        space_none = _create_space(db, title="None Compat", days=[1, 2, 3, 4, 5])

        # 2025-07-06 is Sunday, schedule 08-12
        slots = _make_slots("2025-07-06", 8, 12)

        resp_full = _schedule_compat(client, space_full.id, slots, auth_headers)
        assert resp_full.json()["compatibility"] == "full"

        resp_partial = _schedule_compat(client, space_partial.id, slots, auth_headers)
        assert resp_partial.json()["compatibility"] == "partial"
        assert resp_partial.json()["available_count"] == 2  # 10, 11

        resp_none = _schedule_compat(client, space_none.id, slots, auth_headers)
        assert resp_none.json()["compatibility"] == "none"

    def test_campaign_cost_aggregation(self, client, db, test_user, auth_headers):
        """Total campaign cost = sum of each order's cost at their space's price."""
        space_a = _create_space(db, title="Price A", price=100)
        space_b = _create_space(db, title="Price B", price=150)
        space_c = _create_space(db, title="Price C", price=200)

        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        # 2 hours each
        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_c = _book(client, space_c.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)

        # prorated: price/12 * 2h
        assert round(float(resp_a.json()["total_cost"]), 2) == 16.67   # 100/12 * 2
        assert float(resp_b.json()["total_cost"]) == 25.0              # 150/12 * 2
        assert round(float(resp_c.json()["total_cost"]), 2) == 33.33   # 200/12 * 2

        # Verify all linked
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        assert len(items) == 1
        assert len(items[0]["child_orders"]) == 2

    def test_estimated_cost_per_space(self, client, db, test_user, auth_headers):
        """Schedule-based compatibility returns correct estimated cost per space."""
        space_cheap = _create_space(db, title="Cheap Space", price=50)
        space_expensive = _create_space(db, title="Expensive Space", price=300)

        slots = _make_slots("2025-07-01", 10, 14)  # 4 hours

        resp_cheap = _schedule_compat(client, space_cheap.id, slots, auth_headers)
        # prorated: 50/12 * 4 ≈ 16.67
        assert round(resp_cheap.json()["estimated_cost"], 2) == 16.67

        resp_exp = _schedule_compat(client, space_expensive.id, slots, auth_headers)
        # prorated: 300/12 * 4 = 100.0
        assert resp_exp.json()["estimated_cost"] == 100.0


# ════════════════════════════════════════════
#  PART 10: Cancel Campaign Cascade & Cleanup
# ════════════════════════════════════════════

class TestCampaignCancellation:
    """Campaign cancellation and its effect on orders."""

    def test_cancel_campaign_cancels_pending_orders(self, client, db, test_user, auth_headers):
        """Cancelling a campaign should cancel all its pending orders."""
        space_a = _create_space(db, title="Cancel Camp A")
        space_b = _create_space(db, title="Cancel Camp B")

        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)
        assert resp_a.status_code == 201
        assert resp_b.status_code == 201

        # Cancel campaign
        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # All orders should be cancelled
        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert resp.status_code == 200
        for order in resp.json()["orders"]:
            assert order["status"] == "cancelled"

    def test_cancel_campaign_frees_time_slots(self, client, db, test_user, auth_headers):
        """Cancelled orders should free up capacity for other users."""
        space = _create_space(db, title="Cancel Free Slots")

        # Fill capacity minus 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"cancel_free_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        # Create campaign with order that takes the last slot
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00",
                     auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201

        # Now at capacity — verify
        slots = _make_slots("2025-07-01", 9, 10)
        new_user_headers, _ = _create_user_headers(client, db, "cancel_checker@test.com")
        resp = _schedule_compat(client, space.id, slots, new_user_headers)
        assert resp.json()["compatibility"] == "none"

        # Cancel campaign → should free the slot
        client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)

        resp = _schedule_compat(client, space.id, slots, new_user_headers)
        assert resp.json()["compatibility"] == "full"


# ════════════════════════════════════════════
#  PART 11: Schedule vs Order Compat Consistency
# ════════════════════════════════════════════

class TestCompatibilityConsistencyDeep:
    """Deeper consistency checks between schedule-based and order-based endpoints."""

    def test_consistency_with_capacity_pressure(self, client, db, test_user, auth_headers):
        """Both endpoints agree when some hours are at capacity on target."""
        space_a = _create_space(db, title="Consist Cap A")
        space_b = _create_space(db, title="Consist Cap B")

        # Fill 10:00 on space B to capacity
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"cc_fill_{i}@test.com")
            _book(client, space_b.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Create order on space A: 09-12
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Order-based
        resp1 = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        data1 = resp1.json()

        # Schedule-based
        slots = _make_slots("2025-07-01", 9, 12)
        resp2 = _schedule_compat(client, space_b.id, slots, auth_headers)
        data2 = resp2.json()

        assert data1["compatibility"] == data2["compatibility"] == "partial"
        assert data1["available_count"] == data2["available_count"] == 2  # 09, 11
        assert data1["conflict_count"] == data2["conflict_count"] == 1  # 10 full
        assert data1["estimated_cost"] == data2["estimated_cost"]

    def test_consistency_multiday_mixed(self, client, db, test_user, auth_headers):
        """Multi-day: one day fully available, one day partially, both endpoints agree."""
        space_a = _create_space(db, title="Consist Multi A")
        # Space B: open Mon-Sat (0-5), closed Sunday (6)
        space_b = _create_space(db, title="Consist Multi B", days=[0, 1, 2, 3, 4, 5],
                                start_hour=10, end_hour=18)

        # Schedule on Tue 2025-07-01 (day=2) and Sun 2025-07-06 (day=0 — available)
        # and request 08-12 (08,09 outside B's hours)
        days_data = [
            ("2025-07-01", "08:00:00", "12:00:00"),
            ("2025-07-06", "08:00:00", "12:00:00"),
        ]

        # Create order on space A
        resp = _book_multiday(client, space_a.id, days_data, auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Order-based
        resp1 = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        data1 = resp1.json()

        # Schedule-based
        slots = _make_slots("2025-07-01", 8, 12) + _make_slots("2025-07-06", 8, 12)
        resp2 = _schedule_compat(client, space_b.id, slots, auth_headers)
        data2 = resp2.json()

        assert data1["compatibility"] == data2["compatibility"]
        assert data1["available_count"] == data2["available_count"]
        assert data1["conflict_count"] == data2["conflict_count"]

    def test_consistency_all_none(self, client, db, test_user, auth_headers):
        """Both endpoints return 'none' when target is closed on the scheduled day."""
        space_a = _create_space(db, title="Consist None A")
        # Space B: only open weekdays (1-5)
        space_b = _create_space(db, title="Consist None B", days=[1, 2, 3, 4, 5])

        # 2025-07-06 is Sunday
        resp = _book(client, space_a.id, "2025-07-06", "10:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        resp1 = client.get(f"/orders/{order_id}/compatibility/{space_b.id}", headers=auth_headers)
        slots = _make_slots("2025-07-06", 10, 12)
        resp2 = _schedule_compat(client, space_b.id, slots, auth_headers)

        assert resp1.json()["compatibility"] == resp2.json()["compatibility"] == "none"
        assert resp1.json()["available_count"] == resp2.json()["available_count"] == 0


# ════════════════════════════════════════════
#  PART 12: Capacity Edge Cases — Advanced
# ════════════════════════════════════════════

class TestCapacityAdvanced:
    """Advanced capacity scenarios: partial fill, cancelled slots, per-date independence."""

    def test_partial_capacity_different_hours_same_day(self, client, db, test_user, auth_headers):
        """Hour A at capacity, hour B has room — only B is available."""
        space = _create_space(db, title="Cap Partial Hours")

        # Fill 09:00 to capacity
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"cph_9_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        # Fill 10:00 to half
        for i in range(3):
            h, _ = _create_user_headers(client, db, f"cph_10_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Check 09-12 (3 hours): 09 full, 10 has room, 11 empty
        slots = _make_slots("2025-07-01", 9, 12)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 10:00, 11:00
        assert data["conflict_count"] == 1   # 09:00 full

    def test_cancel_one_order_reopens_just_that_slot(self, client, db, test_user, auth_headers):
        """Cancelling one booking reopens only the specific hour it occupied."""
        space = _create_space(db, title="Cap Cancel Specific")

        # Fill 09:00 and 10:00 to capacity
        cancel_headers = None
        cancel_order_id = None
        for hour in [9, 10]:
            for i in range(MAX_SLOTS_PER_HOUR):
                h, _ = _create_user_headers(client, db, f"ccs_{hour}_{i}@test.com")
                resp = _book(client, space.id, "2025-07-01",
                             f"{hour:02d}:00:00", f"{hour+1:02d}:00:00", h)
                assert resp.status_code == 201
                # Keep one booking on 09:00 for cancellation
                if hour == 9 and i == 0:
                    cancel_headers = h
                    cancel_order_id = resp.json()["id"]

        # Both at capacity
        slots = _make_slots("2025-07-01", 9, 11)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.json()["compatibility"] == "none"

        # Cancel one booking at 09:00
        resp = client.put(f"/orders/{cancel_order_id}/cancel", headers=cancel_headers)
        assert resp.status_code == 200

        # Now 09:00 has room, 10:00 still full
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1   # 09:00 now available
        assert data["conflict_count"] == 1    # 10:00 still full

    def test_per_date_capacity_independence(self, client, db, test_user, auth_headers):
        """Same hour, different dates — capacity tracked independently per date."""
        space = _create_space(db, title="Cap Date Indep")

        # Fill 10:00 to capacity on July 1 only
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(client, db, f"cdi_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Check same hour across 3 dates
        slots = (
            _make_slots("2025-07-01", 10, 11) +  # full
            _make_slots("2025-07-02", 10, 11) +  # empty
            _make_slots("2025-07-03", 10, 11)    # empty
        )
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2   # July 2 + July 3
        assert data["conflict_count"] == 1    # July 1

    def test_multiday_order_capacity_each_day(self, client, db, test_user, auth_headers):
        """A multi-day booking consumes one slot per day, not per order."""
        space = _create_space(db, title="Cap Multiday")

        # Fill 10:00 on July 1 to (capacity - 1)
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"cmd_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # One more multi-day booking that takes the last slot on July 1
        h2, _ = _create_user_headers(client, db, "cmd_last@test.com")
        _book_multiday(client, space.id, [
            ("2025-07-01", "10:00:00", "11:00:00"),
            ("2025-07-02", "10:00:00", "11:00:00"),
        ], h2)

        # July 1 at 10:00 is now full; July 2 at 10:00 has only 1 booking
        slots = _make_slots("2025-07-01", 10, 11) + _make_slots("2025-07-02", 10, 11)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1   # July 2
        assert data["conflict_count"] == 1    # July 1 full


# ════════════════════════════════════════════
#  PART 13: Long-Term / Wide Date Range Campaigns
# ════════════════════════════════════════════

class TestLongTermCampaignEdgeCases:
    """Edge cases for campaigns spanning many days."""

    def test_week_long_campaign_with_weekend_only_target(self, client, db, test_user, auth_headers):
        """7-day campaign → target only open Fri+Sat (days 5,6) → partial."""
        space = _create_space(db, title="Weekend Target", days=[5, 6])

        # Mon 2025-06-30 through Sun 2025-07-06
        slots = []
        for day_offset in range(7):
            dt = f"2025-{6+((30+day_offset)//31):02d}-{(30+day_offset-1)%31+1:02d}"
            # Simpler: use known dates
            pass
        # Use known dates: Mon=6/30, Tue=7/1, Wed=7/2, Thu=7/3, Fri=7/4, Sat=7/5, Sun=7/6
        dates = ["2025-06-30", "2025-07-01", "2025-07-02", "2025-07-03",
                 "2025-07-04", "2025-07-05", "2025-07-06"]
        slots = []
        for dt in dates:
            slots += _make_slots(dt, 10, 12)

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        # Fri (7/4, dow=5) and Sat (7/5, dow=6) → 2 days * 2 hours = 4 available
        assert data["available_count"] == 4
        # Other 5 days * 2 hours = 10 conflicts
        assert data["conflict_count"] == 10

    def test_campaign_across_month_boundary(self, client, db, test_user, auth_headers):
        """Campaign spanning June→July with consistent availability."""
        space = _create_space(db, title="Month Boundary")
        slots = (
            _make_slots("2025-06-30", 9, 11) +  # Mon
            _make_slots("2025-07-01", 9, 11) +  # Tue
            _make_slots("2025-07-02", 9, 11)    # Wed
        )

        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 6  # 3 days * 2 hours

    def test_large_campaign_4_spaces_multiday(self, client, db, test_user, auth_headers):
        """4 spaces, 3 days — full end-to-end campaign creation."""
        spaces = [_create_space(db, title=f"Large Camp {c}", price=100 + c * 50)
                  for c in range(4)]

        slots = []
        for dt in ["2025-07-01", "2025-07-02", "2025-07-03"]:
            slots += _make_slots(dt, 10, 13)  # 3 hours/day

        # Check all spaces — all should be full
        for sp in spaces:
            resp = _schedule_compat(client, sp.id, slots, auth_headers)
            assert resp.json()["compatibility"] == "full"
            assert resp.json()["available_count"] == 9

        # Create campaign with all 4
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        days_data = [
            ("2025-07-01", "10:00:00", "13:00:00"),
            ("2025-07-02", "10:00:00", "13:00:00"),
            ("2025-07-03", "10:00:00", "13:00:00"),
        ]
        for sp in spaces:
            resp = _book_multiday(client, sp.id, days_data, auth_headers, campaign_id=campaign_id)
            assert resp.status_code == 201

        # Verify structure
        resp = client.get("/orders/my", headers=auth_headers)
        items = resp.json()["items"]
        assert len(items) == 1
        assert len(items[0]["child_orders"]) == 3  # first is primary, 3 children

    def test_single_viable_space_no_campaign_wrapper(self, client, db, test_user, auth_headers):
        """If schedule compat shows only 1 space viable, user can book just that space
        without creating a campaign. Verify the order stands alone."""
        space_good = _create_space(db, title="Single Viable")
        space_bad = _create_space(db, title="Single Bad", days=[1, 2, 3, 4, 5])

        # Sunday schedule
        slots = _make_slots("2025-07-06", 10, 12)

        resp_good = _schedule_compat(client, space_good.id, slots, auth_headers)
        assert resp_good.json()["compatibility"] == "full"

        resp_bad = _schedule_compat(client, space_bad.id, slots, auth_headers)
        assert resp_bad.json()["compatibility"] == "none"

        # Create single order, no campaign
        resp = _book(client, space_good.id, "2025-07-06", "10:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        assert resp.json()["campaign_id"] is None

        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["campaign_id"] is None


# ════════════════════════════════════════════
#  PART 14: Admin Campaign Delete (Cascade)
# ════════════════════════════════════════════

class TestAdminCampaignDelete:
    """Admin can delete a campaign and all its orders cascade-delete."""

    def test_admin_delete_campaign_removes_orders(self, client, db, test_user, auth_headers, admin_headers):
        """Admin deletes a campaign → all orders under it are gone."""
        space_a = _create_space(db, title="Admin Del A")
        space_b = _create_space(db, title="Admin Del B")

        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        assert resp_a.status_code == 201
        assert resp_b.status_code == 201
        order_a_id = resp_a.json()["id"]
        order_b_id = resp_b.json()["id"]

        # Admin deletes campaign
        resp = client.delete(f"/admin/campaigns/{campaign_id}", headers=admin_headers)
        assert resp.status_code == 204

        # Orders should be gone
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 0

        # Campaign should be gone
        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert resp.status_code == 404

    def test_admin_delete_frees_capacity(self, client, db, test_user, auth_headers, admin_headers):
        """Deleting a campaign frees up the time slots its orders occupied."""
        space = _create_space(db, title="Admin Del Cap")

        # Fill to (capacity - 1)
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"adc_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Campaign takes last slot
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]
        _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        # Capacity full
        checker_h, _ = _create_user_headers(client, db, "adc_checker@test.com")
        slots = _make_slots("2025-07-01", 10, 11)
        resp = _schedule_compat(client, space.id, slots, checker_h)
        assert resp.json()["compatibility"] == "none"

        # Admin deletes campaign
        client.delete(f"/admin/campaigns/{campaign_id}", headers=admin_headers)

        # Slot freed
        resp = _schedule_compat(client, space.id, slots, checker_h)
        assert resp.json()["compatibility"] == "full"

    def test_admin_delete_nonexistent_campaign_404(self, client, db, test_user, admin_headers):
        """Deleting a campaign that doesn't exist returns 404."""
        resp = client.delete("/admin/campaigns/99999", headers=admin_headers)
        assert resp.status_code == 404

    def test_non_admin_cannot_delete_campaign(self, client, db, test_user, auth_headers):
        """Regular user cannot call admin delete endpoint."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        campaign_id = resp.json()["id"]

        resp = client.delete(f"/admin/campaigns/{campaign_id}", headers=auth_headers)
        assert resp.status_code in (401, 403)


# ════════════════════════════════════════════
#  PART 15: Schedule Compat Has No Side Effects
# ════════════════════════════════════════════

class TestScheduleCompatNoSideEffects:
    """Verify schedule-based compat is purely read-only — no DB writes."""

    def test_repeated_checks_no_cumulative_effect(self, client, db, test_user, auth_headers):
        """Calling schedule compat 10 times doesn't affect capacity."""
        space = _create_space(db, title="No Side Effect")
        slots = _make_slots("2025-07-01", 9, 12)

        for _ in range(10):
            resp = _schedule_compat(client, space.id, slots, auth_headers)
            assert resp.status_code == 200
            assert resp.json()["compatibility"] == "full"
            assert resp.json()["available_count"] == 3

        # Capacity unchanged — still can book
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201

    def test_compat_check_does_not_create_orders(self, client, db, test_user, auth_headers):
        """Schedule compat for 5 different spaces creates zero orders."""
        spaces = [_create_space(db, title=f"NoOrder {i}") for i in range(5)]
        slots = _make_slots("2025-07-01", 10, 14)

        for sp in spaces:
            resp = _schedule_compat(client, sp.id, slots, auth_headers)
            assert resp.status_code == 200

        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 0

    def test_compat_check_does_not_create_campaigns(self, client, db, test_user, auth_headers):
        """Schedule compat checks don't create any campaign entities."""
        space = _create_space(db, title="NoCampaign Create")
        slots = _make_slots("2025-07-01", 9, 10)

        _schedule_compat(client, space.id, slots, auth_headers)

        resp = client.get("/campaigns/my", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_compat_check_does_not_affect_other_bookings(self, client, db, test_user, auth_headers):
        """Existing bookings are untouched by schedule compat calls."""
        space = _create_space(db, title="NoAffect")

        # Book 09-10
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        # Run compat check on same space/slot (as a different user)
        other_h, _ = _create_user_headers(client, db, "noaffect_other@test.com")
        slots = _make_slots("2025-07-01", 9, 12)
        _schedule_compat(client, space.id, slots, other_h)

        # Original order unchanged
        resp = client.get(f"/orders/{order_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"
        assert len(resp.json()["time_slots"]) > 0
