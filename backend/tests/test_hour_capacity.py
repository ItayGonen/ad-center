"""
Comprehensive tests for hour-slot capacity logic.

Covers the 6-dot capacity indicator backend: availability endpoint hour_slots,
slot position assignment, capacity conflicts, cancelled slot handling,
exclude_order for edits, multi-user slot filling, and edge cases.
"""
from datetime import date, time
from app.models.space import Space, SpaceOperatingHours
from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR


# ────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────

def _create_space(db, start_hour=8, end_hour=20):
    """Create a space with operating hours for all 7 days."""
    space = Space(name="Capacity Test Space", city="Tel Aviv", price_per_day=100)
    db.add(space)
    db.commit()
    db.refresh(space)
    for day in range(7):
        db.add(SpaceOperatingHours(
            space_id=space.id,
            day_of_week=day,
            start_time=time(start_hour, 0),
            end_time=time(end_hour, 0),
        ))
    db.commit()
    return space


def _create_user_headers(client, db, email, name="User"):
    """Register a user and return auth headers."""
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


def _get_availability(client, space_id, dt):
    """Get availability for a single date."""
    resp = client.get(f"/spaces/{space_id}/availability", params={
        "start_date": dt,
        "end_date": dt,
    })
    assert resp.status_code == 200
    return resp.json()


def _get_hour_slot(avail_data, hour_str):
    """Extract a specific HourSlotInfo from the availability response."""
    for day in avail_data:
        for hs in day.get("hour_slots", []):
            if hs["hour"] == hour_str:
                return hs
    return None


# ────────────────────────────────────────────
#  1. Availability — hour_slots structure
# ────────────────────────────────────────────

class TestAvailabilityHourSlots:
    """Verify the availability endpoint returns correct hour_slots data."""

    def test_empty_space_all_slots_zero(self, client, db, test_user, auth_headers):
        """A space with no bookings should report booked_count=0 for every hour."""
        space = _create_space(db)
        data = _get_availability(client, space.id, "2025-06-01")
        assert len(data) == 1
        day = data[0]
        assert day["operating_hours"] is not None
        for hs in day["hour_slots"]:
            assert hs["booked_count"] == 0
            assert hs["max_slots"] == MAX_SLOTS_PER_HOUR

    def test_single_booking_increments_count(self, client, db, test_user, auth_headers):
        """After one booking in 09:00-10:00, booked_count for that hour should be 1."""
        space = _create_space(db)
        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", auth_headers)
        assert resp.status_code == 201

        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "09:00")
        assert hs is not None
        assert hs["booked_count"] == 1
        assert hs["max_slots"] == 6

    def test_multi_hour_booking_increments_each_hour(self, client, db, test_user, auth_headers):
        """A 09:00-12:00 booking should increment booked_count for 09, 10, 11."""
        space = _create_space(db)
        _book_hour(client, space.id, "2025-06-01", "09:00:00", "12:00:00", auth_headers)

        data = _get_availability(client, space.id, "2025-06-01")
        for hour_str in ["09:00", "10:00", "11:00"]:
            hs = _get_hour_slot(data, hour_str)
            assert hs["booked_count"] == 1, f"Expected 1 for {hour_str}"
        # 12:00 should be unaffected
        hs12 = _get_hour_slot(data, "12:00")
        assert hs12["booked_count"] == 0

    def test_all_hours_in_operating_range(self, client, db, test_user, auth_headers):
        """hour_slots should cover every hour in operating range (8-20 = 12 hours)."""
        space = _create_space(db, start_hour=8, end_hour=20)
        data = _get_availability(client, space.id, "2025-06-01")
        hours = [hs["hour"] for hs in data[0]["hour_slots"]]
        assert len(hours) == 12
        assert hours[0] == "08:00"
        assert hours[-1] == "19:00"

    def test_day_without_operating_hours_excluded(self, client, db, test_user, auth_headers):
        """If a specific day-of-week has no operating hours, it's omitted."""
        space = Space(name="Partial Space", city="Tel Aviv", price_per_day=50)
        db.add(space)
        db.commit()
        db.refresh(space)
        # Only add operating hours for Monday (day_of_week=2 in our system: Python weekday 0=Monday -> (0+1)%7=1)
        # 2025-06-02 is Monday. Python weekday=0 -> dow=(0+1)%7=1
        db.add(SpaceOperatingHours(
            space_id=space.id, day_of_week=1, start_time=time(9, 0), end_time=time(17, 0),
        ))
        db.commit()

        # Query for Monday (has hours) and Tuesday (no hours)
        resp = client.get(f"/spaces/{space.id}/availability", params={
            "start_date": "2025-06-02",
            "end_date": "2025-06-03",
        })
        assert resp.status_code == 200
        data = resp.json()
        dates = [d["date"] for d in data]
        assert "2025-06-02" in dates  # Monday — has hours
        assert "2025-06-03" not in dates  # Tuesday — no hours


# ────────────────────────────────────────────
#  2. Capacity fill-up — 6 slots per hour
# ────────────────────────────────────────────

class TestCapacityFillUp:
    """Test progressively filling an hour from 0/6 to 6/6."""

    def test_fill_all_six_slots(self, client, db):
        """Six different users can each book the same hour; the 7th gets 409."""
        space = _create_space(db)

        users = []
        for i in range(7):
            h, u = _create_user_headers(client, db, f"user{i}@test.com", f"User {i}")
            users.append((h, u))

        # Book slots 1 through 6
        for i in range(6):
            resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", users[i][0])
            assert resp.status_code == 201, f"Slot {i+1} should succeed"

        # Verify availability shows 6/6
        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "09:00")
        assert hs["booked_count"] == 6
        assert hs["max_slots"] == 6

        # 7th booking should get 409 CONFLICT
        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", users[6][0])
        assert resp.status_code == 409

    def test_conflict_response_structure(self, client, db):
        """The 409 conflict response should include structured conflict details."""
        space = _create_space(db)
        users = []
        for i in range(7):
            h, u = _create_user_headers(client, db, f"conf{i}@test.com")
            users.append(h)

        for i in range(6):
            _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", users[i])

        resp = _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", users[6])
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "conflicts" in detail
        assert len(detail["conflicts"]) == 1
        conflict = detail["conflicts"][0]
        assert conflict["date"] == "2025-06-01"
        assert conflict["hour"] == "10:00"
        assert conflict["booked_count"] == 6
        assert conflict["max_slots"] == 6

    def test_partial_capacity_shown_correctly(self, client, db):
        """With 3 bookings, booked_count=3 and hour is still available."""
        space = _create_space(db)
        users = []
        for i in range(3):
            h, _ = _create_user_headers(client, db, f"partial{i}@test.com")
            users.append(h)

        for h in users:
            resp = _book_hour(client, space.id, "2025-06-01", "14:00:00", "15:00:00", h)
            assert resp.status_code == 201

        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "14:00")
        assert hs["booked_count"] == 3
        # Hour should still be in available_windows
        windows = data[0]["available_windows"]
        avail_hours = set()
        for w in windows:
            sh = int(w["start_time"].split(":")[0])
            eh = int(w["end_time"].split(":")[0])
            for h in range(sh, eh):
                avail_hours.add(h)
        assert 14 in avail_hours

    def test_full_hour_removed_from_available_windows(self, client, db):
        """A 6/6 hour should NOT appear in available_windows."""
        space = _create_space(db)
        users = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"full{i}@test.com")
            users.append(h)

        for h in users:
            _book_hour(client, space.id, "2025-06-01", "12:00:00", "13:00:00", h)

        data = _get_availability(client, space.id, "2025-06-01")
        windows = data[0]["available_windows"]
        avail_hours = set()
        for w in windows:
            sh = int(w["start_time"].split(":")[0])
            eh = int(w["end_time"].split(":")[0])
            for h in range(sh, eh):
                avail_hours.add(h)
        assert 12 not in avail_hours, "Full hour should not be available"

    def test_full_hour_splits_available_windows(self, client, db):
        """A full hour at 12:00 should split available_windows around it."""
        space = _create_space(db, start_hour=10, end_hour=15)
        users = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"split{i}@test.com")
            users.append(h)

        for h in users:
            _book_hour(client, space.id, "2025-06-01", "12:00:00", "13:00:00", h)

        data = _get_availability(client, space.id, "2025-06-01")
        windows = data[0]["available_windows"]
        # Should be two windows: 10:00-12:00 and 13:00-15:00
        assert len(windows) == 2
        w_starts = sorted([w["start_time"] for w in windows])
        assert "10:00" in w_starts[0]
        assert "13:00" in w_starts[1]


# ────────────────────────────────────────────
#  3. Slot position assignment
# ────────────────────────────────────────────

class TestSlotPositions:
    """Verify slot_position is assigned sequentially 1-6."""

    def test_positions_assigned_sequentially(self, client, db):
        """Each booking in the same hour gets the next position."""
        space = _create_space(db)
        users = []
        for i in range(4):
            h, _ = _create_user_headers(client, db, f"pos{i}@test.com")
            users.append(h)

        for h in users:
            _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h)

        slots = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 6, 1),
            SpaceTimeSlot.start_time == time(9, 0),
        ).order_by(SpaceTimeSlot.slot_position).all()

        positions = [s.slot_position for s in slots]
        assert positions == [1, 2, 3, 4]

    def test_different_hours_get_independent_positions(self, client, db, test_user, auth_headers):
        """Positions reset per-hour: booking 09:00 and 10:00 both get position 1."""
        space = _create_space(db)
        _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", auth_headers)
        _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", auth_headers)

        slot09 = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 6, 1),
            SpaceTimeSlot.start_time == time(9, 0),
        ).first()
        slot10 = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 6, 1),
            SpaceTimeSlot.start_time == time(10, 0),
        ).first()

        assert slot09.slot_position == 1
        assert slot10.slot_position == 1

    def test_different_dates_get_independent_positions(self, client, db, test_user, auth_headers):
        """Positions reset per-date: same hour on two dates both get position 1."""
        space = _create_space(db)
        _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", auth_headers)
        _book_hour(client, space.id, "2025-06-02", "09:00:00", "10:00:00", auth_headers)

        slot_d1 = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 6, 1),
            SpaceTimeSlot.start_time == time(9, 0),
        ).first()
        slot_d2 = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.space_id == space.id,
            SpaceTimeSlot.date == date(2025, 6, 2),
            SpaceTimeSlot.start_time == time(9, 0),
        ).first()

        assert slot_d1.slot_position == 1
        assert slot_d2.slot_position == 1


# ────────────────────────────────────────────
#  4. Cancelled slots don't count
# ────────────────────────────────────────────

class TestCancelledSlots:
    """Cancelled orders' slots should not affect capacity."""

    def test_cancelled_order_frees_capacity(self, client, db):
        """After cancelling an order, availability should show decreased booked_count."""
        space = _create_space(db)
        h1, _ = _create_user_headers(client, db, "canc1@test.com")
        h2, _ = _create_user_headers(client, db, "canc2@test.com")

        # Book two orders
        r1 = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h1)
        r2 = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h2)
        assert r1.status_code == 201
        assert r2.status_code == 201

        # Verify booked_count = 2
        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "09:00")["booked_count"] == 2

        # Cancel first order
        order_id = r1.json()["id"]
        cancel_resp = client.put(f"/orders/{order_id}/cancel", headers=h1)
        assert cancel_resp.status_code == 200

        # Verify booked_count dropped to 1
        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "09:00")
        # Cancel deletes slots, so count should be 1
        assert hs["booked_count"] == 1

    def test_cancel_full_hour_makes_it_available_again(self, client, db):
        """After filling 6/6 and cancelling one, the hour should be bookable again."""
        space = _create_space(db)
        users = []
        responses = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"refill{i}@test.com")
            users.append(h)
            resp = _book_hour(client, space.id, "2025-06-01", "15:00:00", "16:00:00", h)
            assert resp.status_code == 201
            responses.append(resp)

        # Hour is full
        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "15:00")["booked_count"] == 6

        # Cancel one
        oid = responses[2].json()["id"]
        client.put(f"/orders/{oid}/cancel", headers=users[2])

        # Now booked_count should be 5, and a new booking should succeed
        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "15:00")["booked_count"] == 5

        # New user can book
        h_new, _ = _create_user_headers(client, db, "refillnew@test.com")
        resp = _book_hour(client, space.id, "2025-06-01", "15:00:00", "16:00:00", h_new)
        assert resp.status_code == 201


# ────────────────────────────────────────────
#  5. exclude_order on availability
# ────────────────────────────────────────────

class TestExcludeOrder:
    """The exclude_order param should hide that order's slots from availability counts."""

    def test_exclude_order_lowers_booked_count(self, client, db):
        """Excluding an order from availability should lower booked_count."""
        space = _create_space(db)
        h1, _ = _create_user_headers(client, db, "excl1@test.com")
        h2, _ = _create_user_headers(client, db, "excl2@test.com")

        r1 = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h1)
        r2 = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h2)
        order1_id = r1.json()["id"]

        # Without exclude: booked_count=2
        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "09:00")["booked_count"] == 2

        # With exclude_order=order1: booked_count=1
        resp = client.get(f"/spaces/{space.id}/availability", params={
            "start_date": "2025-06-01",
            "end_date": "2025-06-01",
            "exclude_order": order1_id,
        })
        data = resp.json()
        assert _get_hour_slot(data, "09:00")["booked_count"] == 1

    def test_exclude_full_hour_makes_available(self, client, db):
        """Excluding the only orders filling an hour should make it available again."""
        space = _create_space(db)
        order_ids = []
        users = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"exclf{i}@test.com")
            users.append(h)
            resp = _book_hour(client, space.id, "2025-06-01", "11:00:00", "12:00:00", h)
            order_ids.append(resp.json()["id"])

        # Without exclude: hour is full, not in available_windows
        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "11:00")["booked_count"] == 6

        # Exclude one order: now 5/6, should be in available_windows
        resp = client.get(f"/spaces/{space.id}/availability", params={
            "start_date": "2025-06-01",
            "end_date": "2025-06-01",
            "exclude_order": order_ids[0],
        })
        data = resp.json()
        assert _get_hour_slot(data, "11:00")["booked_count"] == 5
        windows = data[0]["available_windows"]
        avail_hours = set()
        for w in windows:
            sh = int(w["start_time"].split(":")[0])
            eh = int(w["end_time"].split(":")[0])
            for h in range(sh, eh):
                avail_hours.add(h)
        assert 11 in avail_hours


# ────────────────────────────────────────────
#  6. Edit order capacity checks
# ────────────────────────────────────────────

class TestEditOrderCapacity:
    """Editing an order should re-validate capacity excluding own slots."""

    def test_edit_order_into_same_hour_succeeds(self, client, db):
        """Editing an order to keep the same hour should not conflict with itself."""
        space = _create_space(db)
        h1, _ = _create_user_headers(client, db, "edit1@test.com")

        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h1)
        order_id = resp.json()["id"]

        # Edit to same hour — should succeed (excludes own slots)
        edit_resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-06-01",
            "end_date": "2025-06-01",
            "selected_days": [{
                "date": "2025-06-01",
                "time_ranges": [{"start_time": "09:00:00", "end_time": "10:00:00"}],
            }],
        }, headers=h1)
        assert edit_resp.status_code == 200

    def test_edit_order_into_full_hour_fails(self, client, db):
        """Editing to a different hour that's full (by others) should fail."""
        space = _create_space(db)
        users = []
        for i in range(7):
            h, _ = _create_user_headers(client, db, f"editf{i}@test.com")
            users.append(h)

        # Fill 10:00 with 6 users
        for i in range(6):
            _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", users[i])

        # User 7 books 09:00
        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", users[6])
        order_id = resp.json()["id"]

        # Try to edit user 7's order to 10:00 (full) — should fail
        edit_resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-06-01",
            "end_date": "2025-06-01",
            "selected_days": [{
                "date": "2025-06-01",
                "time_ranges": [{"start_time": "10:00:00", "end_time": "11:00:00"}],
            }],
        }, headers=users[6])
        assert edit_resp.status_code == 409

    def test_edit_order_expand_hours(self, client, db):
        """Edit an existing order to cover more hours when capacity is available."""
        space = _create_space(db)
        h1, _ = _create_user_headers(client, db, "editexp@test.com")

        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h1)
        order_id = resp.json()["id"]

        # Expand to 09:00-12:00
        edit_resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-06-01",
            "end_date": "2025-06-01",
            "selected_days": [{
                "date": "2025-06-01",
                "time_ranges": [{"start_time": "09:00:00", "end_time": "12:00:00"}],
            }],
        }, headers=h1)
        assert edit_resp.status_code == 200

        # Verify 3 slots now exist
        data = _get_availability(client, space.id, "2025-06-01")
        for h_str in ["09:00", "10:00", "11:00"]:
            assert _get_hour_slot(data, h_str)["booked_count"] == 1


# ────────────────────────────────────────────
#  7. Multi-hour booking with mixed capacity
# ────────────────────────────────────────────

class TestMixedCapacity:
    """Bookings spanning multiple hours where some hours are full."""

    def test_booking_fails_if_any_hour_in_range_is_full(self, client, db):
        """A 09:00-12:00 booking should fail if 10:00 is 6/6 even if others are free."""
        space = _create_space(db)
        users = []
        for i in range(7):
            h, _ = _create_user_headers(client, db, f"mixed{i}@test.com")
            users.append(h)

        # Fill only 10:00
        for i in range(6):
            _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", users[i])

        # Try to book 09:00-12:00 — crosses the full 10:00 hour
        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "12:00:00", users[6])
        assert resp.status_code == 409
        conflicts = resp.json()["detail"]["conflicts"]
        # Only 10:00 should be in conflicts
        conflict_hours = [c["hour"] for c in conflicts]
        assert "10:00" in conflict_hours
        assert "09:00" not in conflict_hours
        assert "11:00" not in conflict_hours

    def test_booking_succeeds_when_all_hours_have_capacity(self, client, db):
        """A multi-hour booking succeeds when each hour has at least 1 free slot."""
        space = _create_space(db)
        users = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"mixok{i}@test.com")
            users.append(h)

        # Put 5 bookings in 09:00 and 3 in 10:00
        for i in range(5):
            _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", users[i])
        for i in range(3):
            _book_hour(client, space.id, "2025-06-01", "10:00:00", "11:00:00", users[i])

        # User 6 can still book 09:00-11:00 (1 slot left in 09:00, 3 left in 10:00)
        h_new, _ = _create_user_headers(client, db, "mixoknew@test.com")
        resp = _book_hour(client, space.id, "2025-06-01", "09:00:00", "11:00:00", h_new)
        assert resp.status_code == 201


# ────────────────────────────────────────────
#  8. Edge cases
# ────────────────────────────────────────────

class TestEdgeCases:
    """Unusual scenarios and boundary conditions."""

    def test_exactly_max_minus_one_shows_1_remaining(self, client, db):
        """5 out of 6 slots booked: booked_count=5, still available."""
        space = _create_space(db)
        users = []
        for i in range(5):
            h, _ = _create_user_headers(client, db, f"edge5_{i}@test.com")
            users.append(h)

        for h in users:
            _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h)

        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "09:00")
        assert hs["booked_count"] == 5
        assert hs["max_slots"] == 6
        # remaining = 6 - 5 = 1
        # Hour should still be in available_windows
        windows = data[0]["available_windows"]
        avail_hours = set()
        for w in windows:
            sh = int(w["start_time"].split(":")[0])
            eh = int(w["end_time"].split(":")[0])
            for hh in range(sh, eh):
                avail_hours.add(hh)
        assert 9 in avail_hours

    def test_same_user_books_multiple_hours_same_day(self, client, db, test_user, auth_headers):
        """A user can book multiple non-overlapping hours on the same day."""
        space = _create_space(db)
        r1 = _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", auth_headers)
        r2 = _book_hour(client, space.id, "2025-06-01", "14:00:00", "15:00:00", auth_headers)
        assert r1.status_code == 201
        assert r2.status_code == 201

        data = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data, "09:00")["booked_count"] == 1
        assert _get_hour_slot(data, "14:00")["booked_count"] == 1
        # Other hours remain at 0
        assert _get_hour_slot(data, "10:00")["booked_count"] == 0

    def test_booking_at_operating_hours_boundary(self, client, db, test_user, auth_headers):
        """Booking the last operating hour (19:00-20:00 for 8-20 space) should work."""
        space = _create_space(db, start_hour=8, end_hour=20)
        resp = _book_hour(client, space.id, "2025-06-01", "19:00:00", "20:00:00", auth_headers)
        assert resp.status_code == 201

        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "19:00")
        assert hs["booked_count"] == 1

    def test_booking_first_operating_hour(self, client, db, test_user, auth_headers):
        """Booking the first operating hour (08:00-09:00) should work."""
        space = _create_space(db, start_hour=8, end_hour=20)
        resp = _book_hour(client, space.id, "2025-06-01", "08:00:00", "09:00:00", auth_headers)
        assert resp.status_code == 201

        data = _get_availability(client, space.id, "2025-06-01")
        hs = _get_hour_slot(data, "08:00")
        assert hs["booked_count"] == 1

    def test_multiple_dates_independent_capacity(self, client, db, test_user, auth_headers):
        """Capacity tracking is per-date: filling 09:00 on June 1 doesn't affect June 2."""
        space = _create_space(db)
        users = []
        for i in range(6):
            h, _ = _create_user_headers(client, db, f"dateind{i}@test.com")
            users.append(h)

        # Fill 09:00 on June 1
        for h in users:
            _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", h)

        # June 1: 6/6
        data1 = _get_availability(client, space.id, "2025-06-01")
        assert _get_hour_slot(data1, "09:00")["booked_count"] == 6

        # June 2: 0/6 (independent)
        data2 = _get_availability(client, space.id, "2025-06-02")
        assert _get_hour_slot(data2, "09:00")["booked_count"] == 0

    def test_multi_day_availability_range(self, client, db, test_user, auth_headers):
        """Querying a date range returns per-day hour_slots for each day."""
        space = _create_space(db)
        _book_hour(client, space.id, "2025-06-01", "09:00:00", "10:00:00", auth_headers)
        _book_hour(client, space.id, "2025-06-02", "09:00:00", "10:00:00", auth_headers)
        _book_hour(client, space.id, "2025-06-02", "09:00:00", "10:00:00", auth_headers)

        resp = client.get(f"/spaces/{space.id}/availability", params={
            "start_date": "2025-06-01",
            "end_date": "2025-06-02",
        })
        data = resp.json()
        assert len(data) == 2
        day1 = next(d for d in data if d["date"] == "2025-06-01")
        day2 = next(d for d in data if d["date"] == "2025-06-02")

        hs1 = next(hs for hs in day1["hour_slots"] if hs["hour"] == "09:00")
        hs2 = next(hs for hs in day2["hour_slots"] if hs["hour"] == "09:00")
        assert hs1["booked_count"] == 1
        assert hs2["booked_count"] == 2

    def test_narrow_operating_hours(self, client, db, test_user, auth_headers):
        """A space with only 2 operating hours (10-12) should show exactly 2 hour_slots."""
        space = _create_space(db, start_hour=10, end_hour=12)
        data = _get_availability(client, space.id, "2025-06-01")
        hours = [hs["hour"] for hs in data[0]["hour_slots"]]
        assert hours == ["10:00", "11:00"]
