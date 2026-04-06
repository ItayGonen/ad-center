"""
Tests for the Simple and Advanced Booking Flow features.

Simple Booking Flow:
  User picks a single space, sets dates/schedule, optionally adds more spaces
  via compatibility check, then submits all orders (campaign or standalone).

Advanced Booking Flow:
  User selects multiple spaces upfront, configures each independently (dates,
  schedule, creatives), then submits all as a campaign with per-space orders.

Covers:
  - Availability endpoint (per-space calendar data for date picker)
  - Order creation (single and multi-day, long_term type)
  - Campaign lifecycle (create → add orders → finalize)
  - Capacity enforcement during booking
  - Creative upload / duplicate / delete
  - Schedule compatibility (for adding spaces)
  - Cross-space campaign with mixed availability
  - Cancellation and slot freeing
  - Edge cases: boundary hours, concurrent bookings, no operating hours
"""
from datetime import date, time
from io import BytesIO

from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR, OrderCreative
from app.models.space import Space, SpaceOperatingHours, SpaceImage


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


def _create_space_with_image(db, title="Space With Image", start_hour=8, end_hour=20, days=None, price=100):
    """Create a space with operating hours AND an image."""
    space = _create_space(db, title=title, start_hour=start_hour, end_hour=end_hour, days=days, price=price)
    img = SpaceImage(space_id=space.id, image_url="/uploads/test.jpg")
    db.add(img)
    db.commit()
    return space


def _create_user_headers(db, email, name="User"):
    from app.models.user import User, UserRole
    from app.utils.security import hash_password, create_access_token
    user = User(email=email, password=hash_password("Testpass1"), name=name, role=UserRole.user)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}, user


def _book(client, space_id, dt, start, end, headers, campaign_id=None, booking_type="long_term"):
    body = {
        "space_id": space_id,
        "booking_type": booking_type,
        "start_date": dt,
        "end_date": dt,
        "selected_days": [{"date": dt, "time_ranges": [{"start_time": start, "end_time": end}]}],
    }
    if campaign_id is not None:
        body["campaign_id"] = campaign_id
    return client.post("/orders", json=body, headers=headers)


def _book_multiday(client, space_id, days_data, headers, campaign_id=None, booking_type="long_term"):
    """days_data: list of (date_str, start, end)."""
    dates = sorted(set(d[0] for d in days_data))
    selected_days = []
    for dt in dates:
        ranges = [{"start_time": s, "end_time": e} for (d, s, e) in days_data if d == dt]
        selected_days.append({"date": dt, "time_ranges": ranges})
    body = {
        "space_id": space_id,
        "booking_type": booking_type,
        "start_date": dates[0],
        "end_date": dates[-1],
        "selected_days": selected_days,
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


def _schedule_compat(client, target_space_id, slots, headers):
    return client.post("/orders/check-schedule-compatibility", json={
        "target_space_id": target_space_id,
        "slots": slots,
    }, headers=headers)


# ════════════════════════════════════════════
#  PART 1: Availability Endpoint
#  (Frontend date picker → calendar data)
# ════════════════════════════════════════════

class TestAvailabilityForDatePicker:
    """Tests for GET /spaces/{id}/availability — used by both simple and advanced
    booking flows to show the calendar with per-hour capacity."""

    def test_availability_returns_all_days_in_range(self, client, db, test_user, auth_headers):
        """Range of 3 days with operating hours should return 3 day entries."""
        space = _create_space(db, title="Avail Space")
        # 2025-07-01 (Tue), 2025-07-02 (Wed), 2025-07-03 (Thu)
        resp = client.get(f"/spaces/{space.id}/availability?start_date=2025-07-01&end_date=2025-07-03")
        assert resp.status_code == 200
        data = resp.json()
        dates = [d["date"] for d in data]
        assert "2025-07-01" in dates
        assert "2025-07-02" in dates
        assert "2025-07-03" in dates

    def test_availability_skips_days_without_operating_hours(self, client, db, test_user, auth_headers):
        """Space with operating hours only on weekdays skips Saturday/Sunday."""
        # days=[1,2,3,4,5] = Mon-Fri in our system (0=Sun, 6=Sat)
        space = _create_space(db, title="Weekday Only", days=[1, 2, 3, 4, 5])
        # 2025-06-28 (Sat=6), 2025-06-29 (Sun=0), 2025-06-30 (Mon=1)
        resp = client.get(f"/spaces/{space.id}/availability?start_date=2025-06-28&end_date=2025-06-30")
        assert resp.status_code == 200
        data = resp.json()
        dates = [d["date"] for d in data]
        # Saturday and Sunday should be skipped
        assert "2025-06-28" not in dates
        assert "2025-06-29" not in dates
        assert "2025-06-30" in dates

    def test_availability_shows_hour_slots_with_capacity(self, client, db, test_user, auth_headers):
        """Each day should have hour_slots showing booked_count and max_slots."""
        space = _create_space(db, title="Hour Slots Space", start_hour=9, end_hour=12)
        resp = client.get(f"/spaces/{space.id}/availability?start_date=2025-07-01&end_date=2025-07-01")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        day = data[0]
        assert "hour_slots" in day
        hours = [h["hour"] for h in day["hour_slots"]]
        assert "09:00" in hours
        assert "10:00" in hours
        assert "11:00" in hours
        assert len(hours) == 3
        for h in day["hour_slots"]:
            assert h["booked_count"] == 0
            assert h["max_slots"] == MAX_SLOTS_PER_HOUR

    def test_availability_reflects_bookings(self, client, db, test_user, auth_headers):
        """After booking 09:00-10:00, that hour shows booked_count=1."""
        space = _create_space(db, title="Booked Space")
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)

        resp = client.get(f"/spaces/{space.id}/availability?start_date=2025-07-01&end_date=2025-07-01")
        data = resp.json()
        day = data[0]
        slot_09 = next(h for h in day["hour_slots"] if h["hour"] == "09:00")
        assert slot_09["booked_count"] == 1

    def test_availability_full_hour_excluded_from_windows(self, client, db, test_user, auth_headers):
        """A fully booked hour (6/6) should not appear in available_windows."""
        space = _create_space(db, title="Full Hour Space")
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"fill_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201

        resp = client.get(f"/spaces/{space.id}/availability?start_date=2025-07-01&end_date=2025-07-01")
        data = resp.json()
        day = data[0]
        # available_windows should not include 09:00
        for win in day["available_windows"]:
            start_h = int(win["start_time"].split(":")[0])
            end_h = int(win["end_time"].split(":")[0])
            assert not (start_h <= 9 < end_h), "09:00 should not be in available windows"

    def test_availability_nonexistent_space_returns_404(self, client, db, test_user, auth_headers):
        resp = client.get("/spaces/99999/availability?start_date=2025-07-01&end_date=2025-07-01")
        assert resp.status_code == 404


# ════════════════════════════════════════════
#  PART 2: Simple Booking Flow — Order Creation
# ════════════════════════════════════════════

class TestSimpleBookingOrderCreation:
    """Simple flow: user picks dates + schedule on one space → creates order."""

    def test_create_single_day_order(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "pending"
        assert data["space_id"] == space.id
        assert "reference_number" in data
        # prorated: price_per_day / operating_hours * booked_hours = 100/12 * 3 = 25.0
        assert float(data["total_cost"]) == 25.0

    def test_create_multiday_order(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        resp = _book_multiday(client, space.id, [
            ("2025-07-01", "09:00:00", "11:00:00"),
            ("2025-07-02", "09:00:00", "11:00:00"),
            ("2025-07-03", "09:00:00", "11:00:00"),
        ], auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        # prorated: (100/12 * 2) * 3 days = 50.0
        assert float(data["total_cost"]) == 50.0

    def test_create_order_generates_time_slots(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        order_id = resp.json()["id"]
        slots = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).all()
        assert len(slots) == 3  # 09, 10, 11
        hours = sorted(s.start_time.hour for s in slots)
        assert hours == [9, 10, 11]

    def test_create_order_no_auth_fails(self, client, db):
        space = _create_space(db)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", {})
        assert resp.status_code == 401

    def test_create_order_nonexistent_space(self, client, db, test_user, auth_headers):
        resp = _book(client, 99999, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 404

    def test_create_order_capacity_conflict(self, client, db, test_user, auth_headers):
        """Booking when hour is at max capacity (6/6) returns 409."""
        space = _create_space(db)
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"cap_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)
            assert resp.status_code == 201

        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "conflicts" in detail

    def test_order_cost_uses_space_price(self, client, db, test_user, auth_headers):
        space = _create_space(db, price=250)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        # prorated: 250/12 * 2 ≈ 41.67
        assert round(float(resp.json()["total_cost"]), 2) == 41.67


# ════════════════════════════════════════════
#  PART 3: Simple Flow — Add More Spaces (Campaign)
# ════════════════════════════════════════════

class TestSimpleFlowCampaignExpansion:
    """After booking one space, user adds more spaces → creates campaign."""

    def test_full_simple_flow_with_campaign(self, client, db, test_user, auth_headers):
        """Book space A → create campaign → check compat on B → book B in campaign."""
        space_a = _create_space(db, title="Space A")
        space_b = _create_space(db, title="Space B", price=150)

        # 1. Book space A
        resp_a = _book(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp_a.status_code == 201
        order_a_id = resp_a.json()["id"]

        # 2. Create campaign
        resp_camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp_camp.status_code == 201
        campaign_id = resp_camp.json()["id"]

        # 3. Assign order A to campaign
        resp_set = client.put(f"/orders/{order_a_id}/set-campaign",
                              json={"campaign_id": campaign_id}, headers=auth_headers)
        assert resp_set.status_code == 200

        # 4. Check compatibility of space B
        resp_compat = client.get(
            f"/orders/{order_a_id}/compatibility/{space_b.id}",
            headers=auth_headers,
        )
        assert resp_compat.status_code == 200
        assert resp_compat.json()["compatibility"] == "full"

        # 5. Book space B in the campaign
        resp_b = _book(client, space_b.id, "2025-07-01", "09:00:00", "12:00:00",
                        auth_headers, campaign_id=campaign_id)
        assert resp_b.status_code == 201
        assert resp_b.json()["campaign_id"] == campaign_id

        # 6. Finalize
        resp_fin = client.post(f"/campaigns/{campaign_id}/finalize", headers=auth_headers)
        assert resp_fin.status_code == 200

    def test_compatibility_partial_narrower_hours(self, client, db, test_user, auth_headers):
        """Space B has narrower hours → partial compatibility."""
        space_a = _create_space(db, title="Wide A", start_hour=8, end_hour=20)
        space_b = _create_space(db, title="Narrow B", start_hour=10, end_hour=18)

        resp_a = _book(client, space_a.id, "2025-07-01", "08:00:00", "12:00:00", auth_headers)
        order_a_id = resp_a.json()["id"]

        resp_compat = client.get(
            f"/orders/{order_a_id}/compatibility/{space_b.id}",
            headers=auth_headers,
        )
        data = resp_compat.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2  # 10:00, 11:00
        assert data["conflict_count"] == 2  # 08:00, 09:00

    def test_compatibility_none_no_operating_hours(self, client, db, test_user, auth_headers):
        """Space B has no hours on the booked day → none."""
        space_a = _create_space(db, title="Space A All Days")
        # 2025-07-01 is Tuesday (dow=3 in our 0=Sun system)
        # Create space B with hours only on Sunday (dow=0)
        space_b = _create_space(db, title="Sunday Only B", days=[0])

        resp_a = _book(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        order_a_id = resp_a.json()["id"]

        resp_compat = client.get(
            f"/orders/{order_a_id}/compatibility/{space_b.id}",
            headers=auth_headers,
        )
        assert resp_compat.json()["compatibility"] == "none"

    def test_compatibility_same_space_rejected(self, client, db, test_user, auth_headers):
        """Can't check compatibility against the same space (without exclude)."""
        space = _create_space(db)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        order_id = resp.json()["id"]

        resp_compat = client.get(
            f"/orders/{order_id}/compatibility/{space.id}",
            headers=auth_headers,
        )
        assert resp_compat.status_code == 400


# ════════════════════════════════════════════
#  PART 4: Advanced Booking Flow
#  (Multi-space, per-space config, campaign)
# ════════════════════════════════════════════

class TestAdvancedBookingFlow:
    """Advanced flow: user selects N spaces, configures each, creates campaign."""

    def test_full_advanced_flow_two_spaces(self, client, db, test_user, auth_headers):
        """Select 2 spaces → create campaign → book each → finalize."""
        space_a = _create_space(db, title="Gym Kadima", price=100)
        space_b = _create_space(db, title="Studio Kadima", price=150)

        # 1. Create campaign
        resp_camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp_camp.status_code == 201
        campaign_id = resp_camp.json()["id"]

        # 2. Book space A with its own schedule
        resp_a = _book_multiday(client, space_a.id, [
            ("2025-07-01", "09:00:00", "12:00:00"),
            ("2025-07-02", "09:00:00", "12:00:00"),
        ], auth_headers, campaign_id=campaign_id)
        assert resp_a.status_code == 201
        # prorated: (100/12 * 3) * 2 days = 50.0
        assert float(resp_a.json()["total_cost"]) == 50.0

        # 3. Book space B with a different schedule (afternoon)
        resp_b = _book_multiday(client, space_b.id, [
            ("2025-07-01", "14:00:00", "18:00:00"),
        ], auth_headers, campaign_id=campaign_id)
        assert resp_b.status_code == 201
        # prorated: 150/12 * 4 = 50.0
        assert float(resp_b.json()["total_cost"]) == 50.0

        # 4. Finalize
        resp_fin = client.post(f"/campaigns/{campaign_id}/finalize", headers=auth_headers)
        assert resp_fin.status_code == 200

        # 5. Campaign detail should have both orders
        resp_detail = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert resp_detail.status_code == 200
        orders = resp_detail.json()["orders"]
        assert len(orders) == 2

    def test_advanced_flow_three_spaces_mixed_schedules(self, client, db, test_user, auth_headers):
        """3 spaces with completely different schedules in one campaign."""
        s1 = _create_space(db, title="Space 1", price=100)
        s2 = _create_space(db, title="Space 2", price=200)
        s3 = _create_space(db, title="Space 3", price=50)

        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        # Space 1: 3 days, morning
        r1 = _book_multiday(client, s1.id, [
            ("2025-07-01", "08:00:00", "10:00:00"),
            ("2025-07-02", "08:00:00", "10:00:00"),
            ("2025-07-03", "08:00:00", "10:00:00"),
        ], auth_headers, campaign_id=cid)
        assert r1.status_code == 201

        # Space 2: 1 day, full day
        r2 = _book(client, s2.id, "2025-07-01", "09:00:00", "17:00:00",
                    auth_headers, campaign_id=cid)
        assert r2.status_code == 201

        # Space 3: 2 days, evening
        r3 = _book_multiday(client, s3.id, [
            ("2025-07-04", "18:00:00", "20:00:00"),
            ("2025-07-05", "18:00:00", "20:00:00"),
        ], auth_headers, campaign_id=cid)
        assert r3.status_code == 201

        detail = client.get(f"/campaigns/{cid}", headers=auth_headers).json()
        assert len(detail["orders"]) == 3

    def test_advanced_flow_per_space_independent_dates(self, client, db, test_user, auth_headers):
        """Each space can have completely independent date ranges."""
        s1 = _create_space(db, title="March Space")
        s2 = _create_space(db, title="April Space")

        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        r1 = _book(client, s1.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)
        r2 = _book(client, s2.id, "2025-08-15", "14:00:00", "15:00:00", auth_headers, campaign_id=cid)
        assert r1.status_code == 201
        assert r2.status_code == 201

        detail = client.get(f"/campaigns/{cid}", headers=auth_headers).json()
        dates = sorted(o["start_date"] for o in detail["orders"])
        assert dates == ["2025-07-01", "2025-08-15"]


# ════════════════════════════════════════════
#  PART 5: Schedule-Based Compatibility
#  (Used by Advanced flow to pre-check spaces)
# ════════════════════════════════════════════

class TestScheduleCompatibilityForAdvanced:
    """Schedule-based compat check used before creating orders in advanced flow."""

    def test_schedule_compat_full(self, client, db, test_user, auth_headers):
        space = _create_space(db, title="Full Target")
        slots = _make_slots("2025-07-01", 9, 14)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 5
        # prorated: 100/12 * 5 ≈ 41.67
        assert round(data["estimated_cost"], 2) == 41.67

    def test_schedule_compat_partial_capacity(self, client, db, test_user, auth_headers):
        """One hour at capacity → partial."""
        space = _create_space(db, title="Partial Cap")
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"sfill_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        slots = _make_slots("2025-07-01", 9, 12)  # 09,10,11
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 2
        assert data["conflict_count"] == 1
        conflict_reasons = [c["reason"] for c in data["conflicts"]]
        assert "capacity_full" in conflict_reasons

    def test_schedule_compat_none_all_full(self, client, db, test_user, auth_headers):
        """Every requested hour at capacity → none."""
        space = _create_space(db, title="All Full")
        for h in range(9, 11):
            for i in range(MAX_SLOTS_PER_HOUR):
                hdr, _ = _create_user_headers(db, f"allfill_{h}_{i}@test.com")
                _book(client, space.id, "2025-07-01", f"{h:02d}:00:00", f"{h+1:02d}:00:00", hdr)

        slots = _make_slots("2025-07-01", 9, 11)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        assert resp.json()["compatibility"] == "none"

    def test_schedule_compat_empty_slots_rejected(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        resp = _schedule_compat(client, space.id, [], auth_headers)
        assert resp.status_code == 400

    def test_schedule_compat_nonexistent_space(self, client, db, test_user, auth_headers):
        slots = _make_slots("2025-07-01", 9, 10)
        resp = _schedule_compat(client, 99999, slots, auth_headers)
        assert resp.status_code == 404

    def test_schedule_compat_multiday(self, client, db, test_user, auth_headers):
        space = _create_space(db, title="Multi Day Target")
        slots = _make_slots("2025-07-01", 9, 11) + _make_slots("2025-07-02", 9, 11)
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 4
        assert data["total_source_slots"] == 4


# ════════════════════════════════════════════
#  PART 5b: Copy-Settings Hour Filtering
#  (Morning / Afternoon / Evening segments)
# ════════════════════════════════════════════

class TestCopySettingsHourFiltering:
    """
    When "Copy settings from" is used in the Advanced flow, the frontend
    now intersects source hours with the target's available hours.
    These backend tests verify the schedule-compatibility endpoint
    correctly flags conflicts for morning/afternoon/evening segments.
    """

    # ── Morning-only source → Evening-only target → none ──

    def test_morning_source_to_evening_target_none(self, client, db, test_user, auth_headers):
        """Morning hours (06-12) copied to evening-only space (18-22) → zero overlap."""
        target = _create_space(db, title="Evening Only", start_hour=18, end_hour=22)
        # Source selected morning hours 06:00-12:00
        slots = _make_slots("2025-07-01", 6, 12)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 6
        # All conflicts should be outside_operating_hours
        for c in data["conflicts"]:
            assert c["reason"] == "outside_operating_hours"

    # ── Evening source → Morning-only target → none ──

    def test_evening_source_to_morning_target_none(self, client, db, test_user, auth_headers):
        """Evening hours (18-22) copied to morning-only space (06-12) → zero overlap."""
        target = _create_space(db, title="Morning Only", start_hour=6, end_hour=12)
        slots = _make_slots("2025-07-01", 18, 22)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 4

    # ── Full-day source → Morning-only target → partial ──

    def test_fullday_source_to_morning_target_partial(self, client, db, test_user, auth_headers):
        """Full-day hours (06-22) copied to morning-only space (06-12) → only morning survives."""
        target = _create_space(db, title="Morning Target", start_hour=6, end_hour=12)
        slots = _make_slots("2025-07-01", 6, 22)  # 16 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6   # 06,07,08,09,10,11
        assert data["conflict_count"] == 10   # 12-22

    # ── Full-day source → Afternoon-only target → partial ──

    def test_fullday_source_to_afternoon_target_partial(self, client, db, test_user, auth_headers):
        """Full-day hours (06-22) copied to afternoon space (12-18) → only afternoon survives."""
        target = _create_space(db, title="Afternoon Target", start_hour=12, end_hour=18)
        slots = _make_slots("2025-07-01", 6, 22)  # 16 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6   # 12,13,14,15,16,17
        assert data["conflict_count"] == 10   # 06-12 + 18-22

    # ── Full-day source → Evening-only target → partial ──

    def test_fullday_source_to_evening_target_partial(self, client, db, test_user, auth_headers):
        """Full-day hours (06-22) copied to evening space (18-22) → only evening survives."""
        target = _create_space(db, title="Evening Target", start_hour=18, end_hour=22)
        slots = _make_slots("2025-07-01", 6, 22)  # 16 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 4   # 18,19,20,21
        assert data["conflict_count"] == 12   # 06-18

    # ── Same segment → full ──

    def test_morning_source_to_morning_target_full(self, client, db, test_user, auth_headers):
        """Morning hours (06-12) copied to another morning space (06-12) → full overlap."""
        target = _create_space(db, title="Also Morning", start_hour=6, end_hour=12)
        slots = _make_slots("2025-07-01", 6, 12)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 6
        assert data["conflict_count"] == 0

    def test_afternoon_source_to_afternoon_target_full(self, client, db, test_user, auth_headers):
        """Afternoon hours (12-18) → same-segment target → full."""
        target = _create_space(db, title="Also Afternoon", start_hour=12, end_hour=18)
        slots = _make_slots("2025-07-01", 12, 18)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 6
        assert data["conflict_count"] == 0

    def test_evening_source_to_evening_target_full(self, client, db, test_user, auth_headers):
        """Evening hours (18-22) → same-segment target → full."""
        target = _create_space(db, title="Also Evening", start_hour=18, end_hour=22)
        slots = _make_slots("2025-07-01", 18, 22)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 4
        assert data["conflict_count"] == 0

    # ── Partial overlap across segments ──

    def test_morning_afternoon_source_to_afternoon_target_partial(self, client, db, test_user, auth_headers):
        """Morning+Afternoon (08-18) copied to afternoon-only (12-18) → only afternoon passes."""
        target = _create_space(db, title="Afternoon Only", start_hour=12, end_hour=18)
        slots = _make_slots("2025-07-01", 8, 18)  # 10 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6   # 12-18
        assert data["conflict_count"] == 4    # 08-12

    def test_afternoon_evening_source_to_morning_afternoon_target_partial(self, client, db, test_user, auth_headers):
        """Afternoon+Evening (12-22) → Morning+Afternoon target (06-18) → only afternoon passes."""
        target = _create_space(db, title="Morning Afternoon", start_hour=6, end_hour=18)
        slots = _make_slots("2025-07-01", 12, 22)  # 10 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6   # 12-18
        assert data["conflict_count"] == 4    # 18-22

    # ── Target wider than source → full ──

    def test_morning_source_to_fullday_target_full(self, client, db, test_user, auth_headers):
        """Morning hours (06-12) → full-day target (06-22) → all fit."""
        target = _create_space(db, title="Full Day", start_hour=6, end_hour=22)
        slots = _make_slots("2025-07-01", 6, 12)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "full"
        assert data["available_count"] == 6
        assert data["conflict_count"] == 0

    # ── Narrower target cuts both ends ──

    def test_wide_source_to_narrow_target_trims_both_ends(self, client, db, test_user, auth_headers):
        """Source 06-22 → target 10-16 → only 10-16 survives, rest conflict."""
        target = _create_space(db, title="Narrow Window", start_hour=10, end_hour=16)
        slots = _make_slots("2025-07-01", 6, 22)  # 16 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 6   # 10,11,12,13,14,15
        assert data["conflict_count"] == 10   # 06-10 (4) + 16-22 (6)

    # ── Multi-day with different day-of-week operating hours ──

    def test_multiday_copy_some_days_no_overlap(self, client, db, test_user, auth_headers):
        """Source has Mon-Fri morning. Target only operates Wed-Fri afternoon.
        Mon/Tue morning → none, Wed/Thu/Fri morning → none (wrong segment)."""
        # Target: only Wed(3), Thu(4), Fri(5) with afternoon hours
        target = _create_space(db, title="Wed-Fri Afternoon", start_hour=12, end_hour=18, days=[3, 4, 5])
        # Source morning slots: Mon 2025-06-30(dow=1) through Fri 2025-07-04(dow=5)
        slots = (
            _make_slots("2025-06-30", 8, 12) +  # Mon (dow=1) - no ops
            _make_slots("2025-07-01", 8, 12) +  # Tue (dow=2) - no ops
            _make_slots("2025-07-02", 8, 12) +  # Wed (dow=3) - has ops but 12-18, morning outside
            _make_slots("2025-07-03", 8, 12) +  # Thu (dow=4) - same
            _make_slots("2025-07-04", 8, 12)    # Fri (dow=5) - same
        )
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 20  # 5 days * 4 hours

    def test_multiday_copy_mixed_overlap(self, client, db, test_user, auth_headers):
        """Source has full-day Mon-Wed. Target operates Mon morning, Tue afternoon, Wed evening.
        Only the matching segment hours should pass per day."""
        from datetime import time as dt_time
        from app.models.space import Space, SpaceOperatingHours

        space = Space(name="Varied Schedule", city="Tel Aviv", price_per_day=100)
        db.add(space)
        db.commit()
        db.refresh(space)

        # Mon(1): morning 06-12
        db.add(SpaceOperatingHours(space_id=space.id, day_of_week=1,
               start_time=dt_time(6, 0), end_time=dt_time(12, 0)))
        # Tue(2): afternoon 12-18
        db.add(SpaceOperatingHours(space_id=space.id, day_of_week=2,
               start_time=dt_time(12, 0), end_time=dt_time(18, 0)))
        # Wed(3): evening 18-22
        db.add(SpaceOperatingHours(space_id=space.id, day_of_week=3,
               start_time=dt_time(18, 0), end_time=dt_time(22, 0)))
        db.commit()

        # Source: full-day 06-22 on Mon/Tue/Wed
        slots = (
            _make_slots("2025-06-30", 6, 22) +  # Mon - 16 hours, 6 pass (06-12)
            _make_slots("2025-07-01", 6, 22) +  # Tue - 16 hours, 6 pass (12-18)
            _make_slots("2025-07-02", 6, 22)    # Wed - 16 hours, 4 pass (18-22)
        )
        resp = _schedule_compat(client, space.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 16  # 6 + 6 + 4
        assert data["conflict_count"] == 32   # (16-6) + (16-6) + (16-4)

    # ── Edge: single overlapping hour ──

    def test_single_hour_overlap_at_boundary(self, client, db, test_user, auth_headers):
        """Source 11:00-13:00 → target afternoon 12-18 → only 12:00 passes."""
        target = _create_space(db, title="Afternoon Boundary", start_hour=12, end_hour=18)
        slots = _make_slots("2025-07-01", 11, 13)  # 11:00, 12:00
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 1   # only 12:00
        assert data["conflict_count"] == 1    # 11:00

    # ── Edge: Friday evening exists in source but not target ──

    def test_friday_evening_missing_in_target(self, client, db, test_user, auth_headers):
        """Real-world scenario: source has Fri 06-22, target closes Fri at 14.
        Evening hours should all conflict."""
        from datetime import time as dt_time
        from app.models.space import Space, SpaceOperatingHours

        # Source space: Fri full day (not needed for compat, but for context)
        # Target space: Fri closes early at 14:00
        target = Space(name="Early Close Fri", city="Herzliya", price_per_day=100)
        db.add(target)
        db.commit()
        db.refresh(target)
        # Fri = dow 5
        db.add(SpaceOperatingHours(space_id=target.id, day_of_week=5,
               start_time=dt_time(6, 0), end_time=dt_time(14, 0)))
        db.commit()

        # Source selected Fri hours 06-22 (like Even Yehuda)
        # 2025-07-04 is a Friday
        slots = _make_slots("2025-07-04", 6, 22)  # 16 hours
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "partial"
        assert data["available_count"] == 8    # 06-14
        assert data["conflict_count"] == 8     # 14-22
        # Verify the conflicting hours are the afternoon/evening ones
        conflict_hours = sorted(c["start_time"] for c in data["conflicts"])
        assert conflict_hours[0] == "14:00:00"
        assert conflict_hours[-1] == "21:00:00"

    # ── Edge: target has NO operating hours on that day ──

    def test_no_operating_hours_on_target_day(self, client, db, test_user, auth_headers):
        """Target has no ops on Saturday. All Saturday slots → conflict."""
        target = _create_space(db, title="No Saturday", days=[0, 1, 2, 3, 4, 5])  # Sun-Fri, no Sat
        # 2025-07-05 is Saturday (dow=6)
        slots = _make_slots("2025-07-05", 8, 12)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 4
        for c in data["conflicts"]:
            assert c["reason"] == "outside_operating_hours"

    # ── Edge: source and target segments adjacent but not overlapping ──

    def test_adjacent_segments_no_overlap(self, client, db, test_user, auth_headers):
        """Source ends at 12:00, target starts at 12:00 → source hour 11:00-12:00
        ends at target start, so 11:00 is outside. But 12:00-13:00 would be inside.
        Testing that boundary is correctly handled."""
        target = _create_space(db, title="Starts At Noon", start_hour=12, end_hour=18)
        # Source hours: 08,09,10,11 (all end <= 12:00 which is target start)
        slots = _make_slots("2025-07-01", 8, 12)
        resp = _schedule_compat(client, target.id, slots, auth_headers)
        data = resp.json()
        assert data["compatibility"] == "none"
        assert data["available_count"] == 0
        assert data["conflict_count"] == 4


# ════════════════════════════════════════════
#  PART 6: Creative Upload & Management
# ════════════════════════════════════════════

class TestCreativeUpload:
    """Creative upload required before completing a space in the advanced flow."""

    def test_upload_creative(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        order_id = order.json()["id"]

        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        resp = client.post(
            f"/orders/{order_id}/creatives",
            files={"file": ("test.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["file_type"] == "image"
        assert "/uploads/" in data["file_url"]

    def test_upload_max_5_creatives(self, client, db, test_user, auth_headers):
        """Cannot upload more than 5 creatives per order."""
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        for i in range(5):
            resp = client.post(
                f"/orders/{order_id}/creatives",
                files={"file": (f"img{i}.png", BytesIO(file_content), "image/png")},
                headers=auth_headers,
            )
            assert resp.status_code == 201

        # 6th should fail
        resp = client.post(
            f"/orders/{order_id}/creatives",
            files={"file": ("img5.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_list_creatives(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        client.post(
            f"/orders/{order_id}/creatives",
            files={"file": ("a.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )

        resp = client.get(f"/orders/{order_id}/creatives", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_delete_creative(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        upload_resp = client.post(
            f"/orders/{order_id}/creatives",
            files={"file": ("del.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )
        creative_id = upload_resp.json()["id"]

        resp = client.delete(f"/orders/{order_id}/creatives/{creative_id}", headers=auth_headers)
        assert resp.status_code == 204

        # Verify deleted
        resp = client.get(f"/orders/{order_id}/creatives", headers=auth_headers)
        assert len(resp.json()) == 0

    def test_upload_to_other_users_order_fails(self, client, db, test_user, auth_headers):
        """Can't upload creative to another user's order."""
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        other_headers, _ = _create_user_headers(db, "other@test.com")
        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        resp = client.post(
            f"/orders/{order_id}/creatives",
            files={"file": ("hack.png", BytesIO(file_content), "image/png")},
            headers=other_headers,
        )
        assert resp.status_code == 404

    def test_duplicate_creatives_between_orders(self, client, db, test_user, auth_headers):
        """Copy creatives from one order to another (same user)."""
        space_a = _create_space(db, title="Source")
        space_b = _create_space(db, title="Target")

        order_a_id = _book(client, space_a.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]
        order_b_id = _book(client, space_b.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        # Upload to order A
        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        client.post(
            f"/orders/{order_a_id}/creatives",
            files={"file": ("src.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )

        # Duplicate to order B
        resp = client.post(
            f"/orders/{order_b_id}/duplicate-creatives-from/{order_a_id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200

        # Verify order B now has creatives
        creatives_b = client.get(f"/orders/{order_b_id}/creatives", headers=auth_headers).json()
        assert len(creatives_b) == 1


# ════════════════════════════════════════════
#  PART 7: Campaign Lifecycle
# ════════════════════════════════════════════

class TestCampaignLifecycle:
    """Campaign CRUD and lifecycle operations."""

    def test_create_campaign(self, client, db, test_user, auth_headers):
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "active"
        assert "id" in data

    def test_list_campaigns(self, client, db, test_user, auth_headers):
        client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        resp = client.get("/campaigns/my", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_campaign_detail_with_orders(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)

        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["orders"]) == 1
        assert data["orders"][0]["space_id"] == space.id

    def test_cancel_campaign_cancels_pending_orders(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]
        order_resp = _book(client, space.id, "2025-07-01", "09:00:00", "11:00:00", auth_headers, campaign_id=cid)
        order_id = order_resp.json()["id"]

        # Cancel campaign
        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Order should be cancelled
        order_detail = client.get(f"/orders/{order_id}", headers=auth_headers)
        assert order_detail.json()["status"] == "cancelled"

    def test_cancel_campaign_frees_slots(self, client, db, test_user, auth_headers):
        """Cancelling campaign frees up time slots for rebooking."""
        space = _create_space(db)
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)

        # Fill remaining capacity
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(db, f"filler_{i}@test.com")
            resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)
            assert resp.status_code == 201

        # Now at 6/6 capacity → next booking should fail
        overflow_h, _ = _create_user_headers(db, "overflow@test.com")
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", overflow_h)
        assert resp.status_code == 409

        # Cancel campaign → frees 1 slot
        client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)

        # Now should succeed (5/6)
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", overflow_h)
        assert resp.status_code == 201

    def test_finalize_nonexistent_campaign_silent(self, client, db, test_user, auth_headers):
        """Finalizing non-existent campaign fails silently (non-critical email)."""
        resp = client.post("/campaigns/99999/finalize", headers=auth_headers)
        assert resp.status_code == 200

    def test_campaign_cross_user_isolation(self, client, db, test_user, auth_headers):
        """User cannot see another user's campaign."""
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        other_h, _ = _create_user_headers(db, "other@test.com")
        resp = client.get(f"/campaigns/{cid}", headers=other_h)
        assert resp.status_code == 404


# ════════════════════════════════════════════
#  PART 8: Order Listing & Grouping
# ════════════════════════════════════════════

class TestOrderListingAndGrouping:
    """Order listing groups campaign orders under the primary."""

    def test_standalone_order_listed(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["child_orders"] == []

    def test_campaign_orders_grouped(self, client, db, test_user, auth_headers):
        """Campaign orders: first created = primary, rest = children."""
        s1 = _create_space(db, title="Primary")
        s2 = _create_space(db, title="Child")
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        _book(client, s1.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)
        _book(client, s2.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)

        resp = client.get("/orders/my", headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1  # Only primary in top-level
        primary = data["items"][0]
        assert len(primary["child_orders"]) == 1

    def test_cross_user_order_isolation(self, client, db, test_user, auth_headers):
        """Users can't see each other's orders."""
        space = _create_space(db)
        _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)

        other_h, _ = _create_user_headers(db, "other@test.com")
        resp = client.get("/orders/my", headers=other_h)
        assert resp.json()["total"] == 0


# ════════════════════════════════════════════
#  PART 9: Order Cancellation & Edit
# ════════════════════════════════════════════

class TestOrderCancellationAndEdit:
    """Cancel and edit orders — relevant for both flows."""

    def test_cancel_pending_order(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    def test_cancel_frees_slots(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]
        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # Slot should be freed
        slots = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).all()
        assert len(slots) == 0

    def test_edit_pending_order(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-07-01",
            "end_date": "2025-07-01",
            "selected_days": [{"date": "2025-07-01", "time_ranges": [
                {"start_time": "09:00:00", "end_time": "13:00:00"}
            ]}],
        }, headers=auth_headers)
        assert resp.status_code == 200
        # prorated: 100/12 * 4 ≈ 33.33
        assert round(float(resp.json()["total_cost"]), 2) == 33.33

    def test_cannot_cancel_other_users_order(self, client, db, test_user, auth_headers):
        space = _create_space(db)
        order_id = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers).json()["id"]

        other_h, _ = _create_user_headers(db, "other@test.com")
        resp = client.put(f"/orders/{order_id}/cancel", headers=other_h)
        assert resp.status_code == 404


# ════════════════════════════════════════════
#  PART 10: Capacity Edge Cases
# ════════════════════════════════════════════

class TestCapacityEdgeCases:
    """Edge cases around the 6-slot-per-hour capacity system."""

    def test_five_of_six_still_available(self, client, db, test_user, auth_headers):
        """5/6 slots taken → 6th booking succeeds."""
        space = _create_space(db)
        for i in range(5):
            h, _ = _create_user_headers(db, f"cap5_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201

    def test_capacity_independent_per_hour(self, client, db, test_user, auth_headers):
        """Full at 09:00 doesn't affect 10:00."""
        space = _create_space(db)
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"hour_cap_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        # 09:00 is full, but 10:00 should be available
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201

    def test_capacity_independent_per_date(self, client, db, test_user, auth_headers):
        """Full on July 1 doesn't affect July 2."""
        space = _create_space(db)
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"date_cap_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        resp = _book(client, space.id, "2025-07-02", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201

    def test_multirange_order_fails_if_any_hour_full(self, client, db, test_user, auth_headers):
        """Booking 09-12 fails if any of those hours is at capacity."""
        space = _create_space(db)
        # Fill 10:00 to capacity
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"part_cap_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Booking 09-12 includes the full 10:00 hour → should fail
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 409

    def test_cancelled_slots_dont_count(self, client, db, test_user, auth_headers):
        """Cancelled orders don't count toward capacity."""
        space = _create_space(db)
        for i in range(MAX_SLOTS_PER_HOUR):
            h, _ = _create_user_headers(db, f"canc_cap_{i}@test.com")
            _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", h)

        # Cancel one → frees slot
        first_slot = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 7, 1),
            SpaceTimeSlot.start_time == time(9, 0),
        ).first()
        first_order_id = first_slot.order_id
        from app.models.user import User
        first_user = db.query(User).join(
            SpaceTimeSlot, SpaceTimeSlot.order_id == first_slot.order_id
        ).first()
        # Cancel via query to free slot
        from app.models.order import Order, OrderStatus
        order = db.query(Order).filter(Order.id == first_order_id).first()
        order.status = OrderStatus.cancelled
        for slot in order.time_slots:
            db.delete(slot)
        db.commit()

        # Now should have room
        resp = _book(client, space.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201


# ════════════════════════════════════════════
#  PART 11: Batch Campaign Compatibility
# ════════════════════════════════════════════

class TestBatchCampaignCompatibility:
    """POST /orders/{id}/campaign-compatibility — check multiple targets at once."""

    def test_batch_compat_multiple_spaces(self, client, db, test_user, auth_headers):
        space_a = _create_space(db, title="Source Space")
        space_b = _create_space(db, title="Full Compat")
        space_c = _create_space(db, title="Narrow", start_hour=10, end_hour=18)

        order = _book(client, space_a.id, "2025-07-01", "08:00:00", "12:00:00", auth_headers)
        order_id = order.json()["id"]

        resp = client.post(f"/orders/{order_id}/campaign-compatibility", json=[
            {"target_space_id": space_b.id},
            {"target_space_id": space_c.id},
        ], headers=auth_headers)
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 2

        # Space B: full compat (same hours)
        assert results[0]["compatibility"] == "full"
        # Space C: partial (opens at 10, so 08,09 conflict)
        assert results[1]["compatibility"] == "partial"


# ════════════════════════════════════════════
#  PART 12: End-to-End Advanced Flow
#  (Full lifecycle with creatives)
# ════════════════════════════════════════════

class TestAdvancedFlowEndToEnd:
    """Complete advanced flow: select spaces → configure each → upload → submit."""

    def test_full_lifecycle(self, client, db, test_user, auth_headers):
        """Mimics the actual frontend flow step by step."""
        s1 = _create_space(db, title="Lift Gym Kadima", price=100)
        s2 = _create_space(db, title="Lift Studio Kadima", price=150)

        # 1. Check availability for both spaces
        avail1 = client.get(f"/spaces/{s1.id}/availability?start_date=2025-07-01&end_date=2025-07-07")
        avail2 = client.get(f"/spaces/{s2.id}/availability?start_date=2025-07-01&end_date=2025-07-07")
        assert avail1.status_code == 200
        assert avail2.status_code == 200

        # 2. Create campaign
        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        # 3. Book space 1 (dates step → schedule step)
        r1 = _book_multiday(client, s1.id, [
            ("2025-07-01", "09:00:00", "12:00:00"),
            ("2025-07-02", "09:00:00", "12:00:00"),
        ], auth_headers, campaign_id=cid)
        assert r1.status_code == 201
        o1_id = r1.json()["id"]

        # 4. Upload creative for space 1
        file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        upload1 = client.post(
            f"/orders/{o1_id}/creatives",
            files={"file": ("ad1.png", BytesIO(file_content), "image/png")},
            headers=auth_headers,
        )
        assert upload1.status_code == 201

        # 5. Book space 2 with different schedule
        r2 = _book(client, s2.id, "2025-07-03", "14:00:00", "18:00:00",
                    auth_headers, campaign_id=cid)
        assert r2.status_code == 201
        o2_id = r2.json()["id"]

        # 6. Duplicate creatives from space 1 to space 2
        dup = client.post(f"/orders/{o2_id}/duplicate-creatives-from/{o1_id}", headers=auth_headers)
        assert dup.status_code == 200

        # 7. Finalize campaign
        fin = client.post(f"/campaigns/{cid}/finalize", headers=auth_headers)
        assert fin.status_code == 200

        # 8. Verify final state
        detail = client.get(f"/campaigns/{cid}", headers=auth_headers).json()
        assert len(detail["orders"]) == 2
        costs = sorted(float(o["total_cost"]) for o in detail["orders"])
        # prorated: s1=(100/12*3)*2=50.0, s2=150/12*4=50.0
        assert costs == [50.0, 50.0]

        # Both orders have creatives
        for order in detail["orders"]:
            creatives = client.get(f"/orders/{order['id']}/creatives", headers=auth_headers).json()
            assert len(creatives) >= 1

    def test_cancel_one_order_in_campaign(self, client, db, test_user, auth_headers):
        """Cancel one order in a multi-order campaign, others stay."""
        s1 = _create_space(db, title="Keep")
        s2 = _create_space(db, title="Cancel")

        camp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = camp.json()["id"]

        r1 = _book(client, s1.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)
        r2 = _book(client, s2.id, "2025-07-01", "09:00:00", "10:00:00", auth_headers, campaign_id=cid)
        o2_id = r2.json()["id"]

        # Cancel just order 2
        client.put(f"/orders/{o2_id}/cancel", headers=auth_headers)

        detail = client.get(f"/campaigns/{cid}", headers=auth_headers).json()
        statuses = {o["space_id"]: o["status"] for o in detail["orders"]}
        assert statuses[s1.id] == "pending"
        assert statuses[s2.id] == "cancelled"
