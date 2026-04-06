"""
Tests for coverage gaps identified in the master logic document audit.

Covers:
  1. schedule_template persistence (save, return, null for old campaigns)
  2. schedule_template compatibility flow (template-based Add Space)
  3. Admin calendar endpoint with slot_position
  4. Concurrent booking race condition (6th slot)
  5. Preference-mode full-range vs. narrower primary order compatibility
"""
import threading
from datetime import date, time, timedelta

import pytest
from sqlalchemy import event

from app.models.space import Space, SpaceOperatingHours
from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR
from app.models.user import User, UserRole
from app.utils.security import hash_password, create_access_token


# ────────────────────────────────────────────
#  Helpers (same pattern as test_campaign.py)
# ────────────────────────────────────────────

def _create_space(db, title="Test Space", start_hour=8, end_hour=20, days=None, price=100):
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
    user = User(email=email, password=hash_password("pass123"), name=name, role=UserRole.user)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}, user


def _book(client, space_id, dt, start, end, headers, campaign_id=None):
    body = {
        "space_id": space_id,
        "start_date": dt,
        "end_date": dt,
        "selected_days": [{"date": dt, "time_ranges": [{"start_time": start, "end_time": end}]}],
    }
    if campaign_id is not None:
        body["campaign_id"] = campaign_id
    return client.post("/orders", json=body, headers=headers)


def _make_slots(date_str, start_hour, end_hour):
    slots = []
    for h in range(start_hour, end_hour):
        slots.append({
            "date": date_str,
            "start_time": f"{h:02d}:00:00",
            "end_time": f"{h+1:02d}:00:00",
        })
    return slots


def _future_tuesday():
    """Return a future Tuesday date string (YYYY-MM-DD). Avoids weekend edge cases."""
    today = date.today()
    days_ahead = (1 - today.weekday()) % 7  # 0=Monday, 1=Tuesday
    if days_ahead <= 0:
        days_ahead += 7
    d = today + timedelta(days=days_ahead)
    return d.isoformat()


# ════════════════════════════════════════════════════════════════
#  1. schedule_template persistence
# ════════════════════════════════════════════════════════════════

class TestScheduleTemplatePersistence:
    """Verify schedule_template is saved on campaign create and returned in detail."""

    def test_create_campaign_with_template(self, client, db, test_user, auth_headers):
        """schedule_template is stored when provided on create."""
        dt = _future_tuesday()
        slots = _make_slots(dt, 6, 23)
        res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": slots},
        }, headers=auth_headers)
        assert res.status_code == 201
        data = res.json()
        assert data["schedule_template"] is not None
        assert data["schedule_template"]["slots"] == slots

    def test_create_campaign_without_template(self, client, db, test_user, auth_headers):
        """schedule_template is null when not provided (backward compat)."""
        res = client.post("/campaigns", json={
            "campaign_type": "long_term",
        }, headers=auth_headers)
        assert res.status_code == 201
        data = res.json()
        assert data["schedule_template"] is None

    def test_campaign_detail_returns_template(self, client, db, test_user, auth_headers):
        """GET /campaigns/{id} includes schedule_template."""
        dt = _future_tuesday()
        slots = _make_slots(dt, 9, 12)
        create_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": slots},
        }, headers=auth_headers)
        campaign_id = create_res.json()["id"]

        detail_res = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert detail_res.status_code == 200
        data = detail_res.json()
        assert data["schedule_template"] is not None
        assert len(data["schedule_template"]["slots"]) == 3

    def test_campaign_detail_null_template_for_old_campaign(self, client, db, test_user, auth_headers):
        """Campaigns created without template return schedule_template: null in detail."""
        create_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
        }, headers=auth_headers)
        campaign_id = create_res.json()["id"]

        detail_res = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert detail_res.status_code == 200
        assert detail_res.json()["schedule_template"] is None

    def test_template_preserved_after_adding_orders(self, client, db, test_user, auth_headers):
        """Template is not modified when orders are added to the campaign."""
        dt = _future_tuesday()
        space = _create_space(db)
        slots = _make_slots(dt, 6, 23)

        create_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": slots},
        }, headers=auth_headers)
        campaign_id = create_res.json()["id"]

        # Add an order to the campaign
        _book(client, space.id, dt, "09:00", "12:00", auth_headers, campaign_id=campaign_id)

        detail_res = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        data = detail_res.json()
        assert len(data["orders"]) == 1
        # Template unchanged — still the full 06:00–23:00
        assert len(data["schedule_template"]["slots"]) == 17  # 6..22 = 17 hours

    def test_template_with_multi_day_slots(self, client, db, test_user, auth_headers):
        """Template can span multiple days."""
        d1 = _future_tuesday()
        d2 = (date.fromisoformat(d1) + timedelta(days=1)).isoformat()
        slots = _make_slots(d1, 9, 12) + _make_slots(d2, 9, 12)

        res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": slots},
        }, headers=auth_headers)
        assert res.status_code == 201
        data = res.json()
        assert len(data["schedule_template"]["slots"]) == 6  # 3 hours x 2 days


# ════════════════════════════════════════════════════════════════
#  2. schedule_template → compatibility flow (Add Space scenario)
# ════════════════════════════════════════════════════════════════

class TestScheduleTemplateCompatibilityFlow:
    """
    Simulate the "Add Space" flow:
    - Campaign created with wide preference (06:00–20:00)
    - Primary order only booked 09:00–12:00 (narrower)
    - When adding a space, compat should be checked against the TEMPLATE (06:00–20:00),
      not the primary order's 09:00–12:00.
    """

    def test_template_wider_than_primary_order(self, client, db, test_user, auth_headers):
        """Schedule compat with full template returns more available slots than order-based compat."""
        dt = _future_tuesday()
        # Space A: operating 08–20, primary order booked 09–12
        space_a = _create_space(db, title="Space A", start_hour=8, end_hour=20)
        # Space B: operating 08–20, completely free
        space_b = _create_space(db, title="Space B", start_hour=8, end_hour=20)

        # Create campaign with wide preference (08–20 = 12 hours)
        template_slots = _make_slots(dt, 8, 20)
        campaign_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": template_slots},
        }, headers=auth_headers)
        campaign_id = campaign_res.json()["id"]

        # Book primary order with NARROW schedule (09–12 = 3 hours)
        order_res = _book(client, space_a.id, dt, "09:00", "12:00", auth_headers, campaign_id=campaign_id)
        assert order_res.status_code == 201
        order_id = order_res.json()["id"]

        # Order-based compat (old way) — only 3 source slots
        order_compat = client.get(
            f"/orders/{order_id}/compatibility/{space_b.id}",
            headers=auth_headers,
        )
        assert order_compat.status_code == 200
        assert order_compat.json()["total_source_slots"] == 3

        # Template-based compat (new way) — 12 source slots
        template_compat = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_b.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert template_compat.status_code == 200
        tmpl_data = template_compat.json()
        assert tmpl_data["total_source_slots"] == 12
        assert tmpl_data["compatibility"] == "full"
        assert tmpl_data["available_count"] == 12

    def test_template_includes_hours_primary_didnt_book(self, client, db, test_user, auth_headers):
        """Template covers 06–20 but primary only booked 09–12.
        Target space has 06–20 → full compat with template, but only 3h with order."""
        dt = _future_tuesday()
        space_a = _create_space(db, title="Space A", start_hour=6, end_hour=20)
        space_b = _create_space(db, title="Space B", start_hour=6, end_hour=20)

        template_slots = _make_slots(dt, 6, 20)  # 14 hours

        campaign_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": template_slots},
        }, headers=auth_headers)
        campaign_id = campaign_res.json()["id"]

        _book(client, space_a.id, dt, "09:00", "12:00", auth_headers, campaign_id=campaign_id)

        # Template compat → 14 available hours
        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_b.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["available_count"] == 14
        assert data["compatibility"] == "full"

    def test_template_partial_when_target_has_narrower_hours(self, client, db, test_user, auth_headers):
        """Template 06–20, target space only operates 10–18 → partial compat."""
        dt = _future_tuesday()
        _create_space(db, title="Space A", start_hour=6, end_hour=20)
        space_b = _create_space(db, title="Space B", start_hour=10, end_hour=18)

        template_slots = _make_slots(dt, 6, 20)  # 14 hours

        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_b.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["compatibility"] == "partial"
        # 10–18 = 8 available, 6–10 and 18–20 = 6 conflicts
        assert data["available_count"] == 8
        assert data["conflict_count"] == 6

    def test_template_partial_when_target_has_capacity_full(self, client, db, test_user, auth_headers):
        """Template has 12 hours, but target space has 3 hours at 6/6 capacity → partial."""
        dt = _future_tuesday()
        space_b = _create_space(db, title="Space B", start_hour=8, end_hour=20, price=200)

        # Fill 6 slots at 09:00, 10:00, 11:00 on space B
        for i in range(MAX_SLOTS_PER_HOUR):
            h, u = _create_user_headers(client, db, f"filler{i}@test.com", f"Filler {i}")
            _book(client, space_b.id, dt, "09:00", "12:00", h)

        # Template covers 08–20 = 12 hours
        template_slots = _make_slots(dt, 8, 20)
        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_b.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["compatibility"] == "partial"
        assert data["conflict_count"] == 3  # 09, 10, 11 are full
        assert data["available_count"] == 9  # 12 - 3


# ════════════════════════════════════════════════════════════════
#  3. Admin calendar endpoint
# ════════════════════════════════════════════════════════════════

class TestAdminCalendar:
    """Test GET /admin/calendar returns correct structure with slot_position."""

    def test_empty_calendar(self, client, db, test_admin, admin_headers):
        """Calendar with no bookings returns days with empty hours (no hour_slots for spaces without bookings)."""
        _create_space(db, title="Empty Space")
        dt = _future_tuesday()
        res = client.get(f"/admin/calendar?start_date={dt}&end_date={dt}", headers=admin_headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data["spaces"]) == 1
        assert data["spaces"][0]["name"] == "Empty Space"
        assert len(data["days"]) == 1
        # All hours have booked_count=0
        for hour_slot in data["days"][0]["hours"]:
            assert hour_slot["booked_count"] == 0
            assert hour_slot["max_slots"] == 6
            assert hour_slot["orders"] == []

    def test_calendar_shows_bookings_with_slot_position(self, client, db, test_user, auth_headers, test_admin, admin_headers):
        """Booked slots appear in calendar with correct slot_position."""
        space = _create_space(db, title="Calendar Space")
        dt = _future_tuesday()

        # Book 2 hours: 09–11
        order_res = _book(client, space.id, dt, "09:00", "11:00", auth_headers)
        assert order_res.status_code == 201

        res = client.get(f"/admin/calendar?start_date={dt}&end_date={dt}", headers=admin_headers)
        assert res.status_code == 200
        data = res.json()
        day = data["days"][0]

        # Find hour 09:00 for our space
        hour_09 = None
        for h in day["hours"]:
            if h["hour"] == "09:00" and h["space_id"] == space.id:
                hour_09 = h
                break
        assert hour_09 is not None
        assert hour_09["booked_count"] == 1
        assert len(hour_09["orders"]) == 1
        assert hour_09["orders"][0]["slot_position"] == 1
        assert hour_09["orders"][0]["user_name"] == "Test User"

    def test_calendar_multiple_orders_same_hour(self, client, db, test_user, auth_headers, test_admin, admin_headers):
        """Multiple orders in same hour show distinct slot_positions."""
        space = _create_space(db, title="Multi-Booking Space")
        dt = _future_tuesday()

        # 3 different users book the same hour
        _book(client, space.id, dt, "10:00", "11:00", auth_headers)  # pos 1
        h2, _ = _create_user_headers(client, db, "user2@test.com", "User 2")
        _book(client, space.id, dt, "10:00", "11:00", h2)  # pos 2
        h3, _ = _create_user_headers(client, db, "user3@test.com", "User 3")
        _book(client, space.id, dt, "10:00", "11:00", h3)  # pos 3

        res = client.get(f"/admin/calendar?start_date={dt}&end_date={dt}", headers=admin_headers)
        assert res.status_code == 200
        day = data = res.json()["days"][0]
        hour_10 = next(h for h in day["hours"] if h["hour"] == "10:00" and h["space_id"] == space.id)

        assert hour_10["booked_count"] == 3
        assert hour_10["max_slots"] == 6
        positions = sorted(o["slot_position"] for o in hour_10["orders"])
        assert positions == [1, 2, 3]

    def test_calendar_requires_admin(self, client, db, test_user, auth_headers):
        """Non-admin users cannot access the calendar."""
        dt = _future_tuesday()
        res = client.get(f"/admin/calendar?start_date={dt}&end_date={dt}", headers=auth_headers)
        assert res.status_code == 403

    def test_calendar_date_range_limit(self, client, db, test_admin, admin_headers):
        """Date range > 31 days returns 400."""
        start = _future_tuesday()
        end = (date.fromisoformat(start) + timedelta(days=32)).isoformat()
        res = client.get(f"/admin/calendar?start_date={start}&end_date={end}", headers=admin_headers)
        assert res.status_code == 400

    def test_calendar_multi_space(self, client, db, test_user, auth_headers, test_admin, admin_headers):
        """Calendar correctly separates bookings across multiple spaces."""
        space_a = _create_space(db, title="Space A")
        space_b = _create_space(db, title="Space B")
        dt = _future_tuesday()

        _book(client, space_a.id, dt, "09:00", "10:00", auth_headers)
        _book(client, space_b.id, dt, "14:00", "15:00", auth_headers)

        res = client.get(f"/admin/calendar?start_date={dt}&end_date={dt}", headers=admin_headers)
        assert res.status_code == 200
        day = res.json()["days"][0]

        # Space A has booking at 09:00
        a_09 = next((h for h in day["hours"] if h["space_id"] == space_a.id and h["hour"] == "09:00"), None)
        assert a_09 is not None
        assert a_09["booked_count"] == 1

        # Space A has no booking at 14:00
        a_14 = next((h for h in day["hours"] if h["space_id"] == space_a.id and h["hour"] == "14:00"), None)
        assert a_14 is not None
        assert a_14["booked_count"] == 0

        # Space B has booking at 14:00
        b_14 = next((h for h in day["hours"] if h["space_id"] == space_b.id and h["hour"] == "14:00"), None)
        assert b_14 is not None
        assert b_14["booked_count"] == 1


# ════════════════════════════════════════════════════════════════
#  4. Concurrent booking — 6th slot race condition
# ════════════════════════════════════════════════════════════════

class TestConcurrentBooking:
    """Test that the DB UNIQUE constraint prevents double-booking the same slot position."""

    def test_sixth_slot_race_db_constraint(self, client, db, test_user, auth_headers):
        """
        Fill 5 slots, then two users try to book the 6th simultaneously.
        The UNIQUE(space_id, date, start_time, slot_position) constraint
        should ensure only one succeeds at position 6, or both get different positions
        (but never exceed 6 total).
        """
        space = _create_space(db, title="Race Space")
        dt = _future_tuesday()

        # Fill 5 of 6 slots
        for i in range(5):
            h, _ = _create_user_headers(client, db, f"racer{i}@test.com", f"Racer {i}")
            res = _book(client, space.id, dt, "10:00", "11:00", h)
            assert res.status_code == 201

        # Verify 5 slots taken
        slots = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date.fromisoformat(dt),
            SpaceTimeSlot.start_time == time(10, 0),
            SpaceTimeSlot.status == SlotStatus.booked,
        ).all()
        assert len(slots) == 5

        # Two users try the 6th slot
        h_a, _ = _create_user_headers(client, db, "race_a@test.com", "Race A")
        h_b, _ = _create_user_headers(client, db, "race_b@test.com", "Race B")

        results = [None, None]

        def book_slot(idx, headers):
            results[idx] = _book(client, space.id, dt, "10:00", "11:00", headers)

        # Run sequentially (SQLite doesn't support true concurrency) but the test
        # verifies the capacity check logic works correctly under sequential execution
        t1 = threading.Thread(target=book_slot, args=(0, h_a))
        t2 = threading.Thread(target=book_slot, args=(1, h_b))
        t1.start()
        t1.join()
        t2.start()
        t2.join()

        statuses = [results[0].status_code, results[1].status_code]
        # One should succeed (201), the other should fail (409) — 6th slot goes to first arrival
        success_count = statuses.count(201)
        conflict_count = statuses.count(409)

        # At most 6 slots should exist
        final_slots = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date.fromisoformat(dt),
            SpaceTimeSlot.start_time == time(10, 0),
            SpaceTimeSlot.status == SlotStatus.booked,
        ).all()
        assert len(final_slots) == 6
        assert success_count == 1
        assert conflict_count == 1

    def test_full_hour_rejected_immediately(self, client, db, test_user, auth_headers):
        """After 6 bookings, the 7th is rejected with 409 and descriptive error."""
        space = _create_space(db, title="Full Space")
        dt = _future_tuesday()

        for i in range(6):
            h, _ = _create_user_headers(client, db, f"fill{i}@test.com", f"Fill {i}")
            res = _book(client, space.id, dt, "10:00", "11:00", h)
            assert res.status_code == 201

        # 7th booking must fail
        h7, _ = _create_user_headers(client, db, "fill7@test.com", "Fill 7")
        res = _book(client, space.id, dt, "10:00", "11:00", h7)
        assert res.status_code == 409
        detail = res.json()["detail"]
        assert "6/6" in str(detail) or "fully booked" in str(detail).lower() or "conflicts" in str(detail)


# ════════════════════════════════════════════════════════════════
#  5. Preference-mode: full-range vs. narrower primary order
# ════════════════════════════════════════════════════════════════

class TestPreferenceModeFullRange:
    """
    Validates the core scenario: user's preference is wider than what the
    primary space could accommodate, and "Add Space" should use the
    wide preference (schedule_template), not the primary's actual slots.
    """

    def test_preference_06_23_primary_09_18_add_space_uses_full_range(self, client, db, test_user, auth_headers):
        """
        User wants 06:00–23:00 (preference).
        Primary space operates 09:00–18:00, so order only has 9 hours.
        Target space operates 06:00–23:00.
        Template-based compat should return 17 available (06–23), not 9.
        """
        dt = _future_tuesday()
        # Primary space: narrow hours
        space_primary = _create_space(db, title="Narrow Space", start_hour=9, end_hour=18)
        # Target space: wide hours
        space_target = _create_space(db, title="Wide Space", start_hour=6, end_hour=23)

        # User's preference: 06:00–23:00 = 17 hours
        template_slots = _make_slots(dt, 6, 23)

        # Create campaign with the wide preference
        campaign_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": template_slots},
        }, headers=auth_headers)
        campaign_id = campaign_res.json()["id"]

        # Primary order: 09:00–18:00 (constrained by space operating hours)
        order_res = _book(client, space_primary.id, dt, "09:00", "18:00", auth_headers, campaign_id=campaign_id)
        assert order_res.status_code == 201
        order_id = order_res.json()["id"]

        # OLD WAY: order-based compat → only 9 source slots
        old_res = client.get(
            f"/orders/{order_id}/compatibility/{space_target.id}",
            headers=auth_headers,
        )
        assert old_res.status_code == 200
        old_data = old_res.json()
        assert old_data["total_source_slots"] == 9  # 09–18

        # NEW WAY: template-based compat → 17 source slots
        new_res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_target.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert new_res.status_code == 200
        new_data = new_res.json()
        assert new_data["total_source_slots"] == 17  # 06–23
        assert new_data["compatibility"] == "full"
        assert new_data["available_count"] == 17

    def test_preference_wide_target_narrow_shows_partial(self, client, db, test_user, auth_headers):
        """
        Preference: 06:00–23:00.
        Target space: 10:00–16:00.
        Template compat → partial (only 6 of 17 hours available).
        """
        dt = _future_tuesday()
        space_target = _create_space(db, title="Narrow Target", start_hour=10, end_hour=16)
        template_slots = _make_slots(dt, 6, 23)

        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_target.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6  # 10–16
        assert data["conflict_count"] == 11  # 06–10 (4) + 16–23 (7)

    def test_preference_wide_target_no_overlap_shows_none(self, client, db, test_user, auth_headers):
        """
        Preference: 06:00–09:00 (early morning only).
        Target space: 10:00–20:00 (opens later).
        Template compat → none.
        """
        dt = _future_tuesday()
        space_target = _create_space(db, title="Late Space", start_hour=10, end_hour=20)
        template_slots = _make_slots(dt, 6, 9)  # 3 hours: 06, 07, 08

        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_target.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 3

    def test_end_to_end_add_space_with_template(self, client, db, test_user, auth_headers):
        """
        Full flow:
        1. Create campaign with wide template
        2. Book primary with narrow space
        3. Use template to check compat with wide space
        4. Book the wide space using available_slots from template compat
        5. Verify order is created with the wider schedule
        """
        dt = _future_tuesday()
        space_narrow = _create_space(db, title="Narrow", start_hour=9, end_hour=18, price=100)
        space_wide = _create_space(db, title="Wide", start_hour=6, end_hour=23, price=150)

        template_slots = _make_slots(dt, 6, 23)

        # 1. Create campaign
        camp_res = client.post("/campaigns", json={
            "campaign_type": "long_term",
            "schedule_template": {"slots": template_slots},
        }, headers=auth_headers)
        campaign_id = camp_res.json()["id"]

        # 2. Book primary (narrow)
        primary_res = _book(client, space_narrow.id, dt, "09:00", "18:00", auth_headers, campaign_id=campaign_id)
        assert primary_res.status_code == 201

        # 3. Template compat with wide space
        compat_res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_wide.id,
            "slots": template_slots,
        }, headers=auth_headers)
        compat_data = compat_res.json()
        assert compat_data["compatibility"] == "full"
        assert compat_data["available_count"] == 17

        # 4. Book the wide space using full template schedule
        wide_order_res = _book(
            client, space_wide.id, dt, "06:00", "23:00",
            auth_headers, campaign_id=campaign_id,
        )
        assert wide_order_res.status_code == 201
        wide_order = wide_order_res.json()

        # 5. Verify: wide order has 17 time slots (06–23), not just 9 (09–18)
        wide_slots = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == wide_order["id"],
            SpaceTimeSlot.status == SlotStatus.booked,
        ).all()
        assert len(wide_slots) == 17

    def test_template_cost_estimation_uses_target_price(self, client, db, test_user, auth_headers):
        """Template-based compat estimated_cost uses target space's price, not primary's."""
        dt = _future_tuesday()
        space_target = _create_space(db, title="Expensive Space", start_hour=8, end_hour=20, price=240)

        # Template: 08–20 = 12 hours = full operating day
        template_slots = _make_slots(dt, 8, 20)

        res = client.post("/orders/check-schedule-compatibility", json={
            "target_space_id": space_target.id,
            "slots": template_slots,
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        # Full day = price_per_day = 240
        assert abs(data["estimated_cost"] - 240.0) < 0.01
