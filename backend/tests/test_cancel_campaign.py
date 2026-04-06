"""
Dedicated test suite for cancel campaign edge cases.

Covers: auth, mixed order statuses, side effects (notifications, events),
capacity/slot cleanup, response shape, and rebooking after cancel.
"""
from datetime import date, time
from app.models.space import Space, SpaceOperatingHours
from app.models.order import Order, OrderStatus, SpaceTimeSlot, MAX_SLOTS_PER_HOUR
from app.models.notification import Notification, NotificationType
from app.models.order_event import OrderEvent, ActionType


# ────────────────────────────────────────────
#  Helpers (copied from test_campaign.py)
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


def _schedule_compat(client, target_space_id, slots, headers):
    """Call the schedule-based compatibility endpoint. Returns response."""
    return client.post("/orders/check-schedule-compatibility", json={
        "target_space_id": target_space_id,
        "slots": slots,
    }, headers=headers)


def _admin_set_status(client, order_id, status, admin_headers):
    """Set an order's status via the admin endpoint."""
    return client.put(f"/admin/orders/{order_id}", json={"status": status}, headers=admin_headers)


def _create_campaign_with_orders(client, db, auth_headers, spaces, dt="2025-07-01",
                                  start="10:00:00", end="11:00:00"):
    """Create a campaign and book one order per space. Returns (campaign_id, [order_ids])."""
    resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
    assert resp.status_code == 201
    campaign_id = resp.json()["id"]

    order_ids = []
    for space in spaces:
        resp = _book(client, space.id, dt, start, end, auth_headers, campaign_id=campaign_id)
        assert resp.status_code == 201
        order_ids.append(resp.json()["id"])

    return campaign_id, order_ids


# ════════════════════════════════════════════
#  Tests
# ════════════════════════════════════════════

class TestCancelCampaignEdgeCases:

    # ── Auth & Access Control ──

    def test_cancel_requires_auth(self, client, db, test_user, auth_headers):
        """No auth header -> 401."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = resp.json()["id"]

        resp = client.put(f"/campaigns/{cid}/cancel")
        assert resp.status_code == 401

    def test_cancel_nonexistent_campaign(self, client, db, test_user, auth_headers):
        """Random ID -> 404."""
        resp = client.put("/campaigns/999999/cancel", headers=auth_headers)
        assert resp.status_code == 404

    # ── Mixed Order Statuses ──

    def test_cancel_skips_confirmed_orders(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Pending -> cancelled, confirmed -> stays confirmed."""
        space_a = _create_space(db, title="SkipConf A")
        space_b = _create_space(db, title="SkipConf B")
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space_a, space_b])

        # Set second order to confirmed via admin
        _admin_set_status(client, order_ids[1], "confirmed", admin_headers)

        # Cancel campaign
        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # Check order statuses
        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        orders = resp.json()["orders"]
        statuses = {o["id"]: o["status"] for o in orders}
        assert statuses[order_ids[0]] == "cancelled"
        assert statuses[order_ids[1]] == "confirmed"

    def test_cancel_skips_completed_orders(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Pending -> cancelled, completed -> stays completed."""
        space_a = _create_space(db, title="SkipComp A")
        space_b = _create_space(db, title="SkipComp B")
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space_a, space_b])

        _admin_set_status(client, order_ids[1], "completed", admin_headers)

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        orders = resp.json()["orders"]
        statuses = {o["id"]: o["status"] for o in orders}
        assert statuses[order_ids[0]] == "cancelled"
        assert statuses[order_ids[1]] == "completed"

    def test_cancel_with_mixed_statuses(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Only pending+approved become cancelled; confirmed/completed/already-cancelled unchanged."""
        spaces = [_create_space(db, title=f"MixSt {i}") for i in range(5)]
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, spaces)

        # order_ids[0] = pending (default)
        # order_ids[1] = approved
        _admin_set_status(client, order_ids[1], "approved", admin_headers)
        # order_ids[2] = confirmed
        _admin_set_status(client, order_ids[2], "confirmed", admin_headers)
        # order_ids[3] = completed
        _admin_set_status(client, order_ids[3], "completed", admin_headers)
        # order_ids[4] = cancelled (cancel individually first)
        _admin_set_status(client, order_ids[4], "cancelled", admin_headers)

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        orders = resp.json()["orders"]
        statuses = {o["id"]: o["status"] for o in orders}

        assert statuses[order_ids[0]] == "cancelled"   # was pending
        assert statuses[order_ids[1]] == "cancelled"   # was approved
        assert statuses[order_ids[2]] == "confirmed"    # untouched
        assert statuses[order_ids[3]] == "completed"    # untouched
        assert statuses[order_ids[4]] == "cancelled"    # was already cancelled

    def test_cancel_skips_already_cancelled_orders(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Already-cancelled order should not get double-processed (no duplicate notifications)."""
        space_a = _create_space(db, title="DblCancel A")
        space_b = _create_space(db, title="DblCancel B")
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space_a, space_b])

        # Cancel second order individually via admin
        _admin_set_status(client, order_ids[1], "cancelled", admin_headers)

        # Count notifications for this order before campaign cancel
        notifs_before = db.query(Notification).filter(
            Notification.related_order_id == order_ids[1],
            Notification.type == NotificationType.order_cancelled,
        ).count()

        # Cancel campaign
        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # No new cancel notification should have been created for the already-cancelled order
        notifs_after = db.query(Notification).filter(
            Notification.related_order_id == order_ids[1],
            Notification.type == NotificationType.order_cancelled,
        ).count()
        assert notifs_after == notifs_before

    # ── Side Effects Verification ──

    def test_cancel_creates_notification_per_order(self, client, db, test_user, auth_headers):
        """Campaign with 3 pending orders -> exactly 3 order_cancelled notifications."""
        spaces = [_create_space(db, title=f"Notif {i}") for i in range(3)]
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, spaces)

        # Clear any pre-existing notifications (e.g. order_created)
        cancel_notifs_before = db.query(Notification).filter(
            Notification.type == NotificationType.order_cancelled,
            Notification.related_order_id.in_(order_ids),
        ).count()
        assert cancel_notifs_before == 0

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        cancel_notifs = db.query(Notification).filter(
            Notification.type == NotificationType.order_cancelled,
            Notification.related_order_id.in_(order_ids),
        ).all()
        assert len(cancel_notifs) == 3
        # Each notification should reference one of our orders
        notified_order_ids = {n.related_order_id for n in cancel_notifs}
        assert notified_order_ids == set(order_ids)

    def test_cancel_creates_order_event_per_order(self, client, db, test_user, auth_headers):
        """Campaign with 3 pending orders -> 3 OrderEvent records with action_type=cancelled."""
        spaces = [_create_space(db, title=f"Event {i}") for i in range(3)]
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, spaces)

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        events = db.query(OrderEvent).filter(
            OrderEvent.order_id.in_(order_ids),
            OrderEvent.action_type == ActionType.cancelled,
        ).all()
        assert len(events) == 3
        for event in events:
            assert "campaign cancellation" in event.description.lower()

    def test_cancel_confirmed_order_keeps_time_slots(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Confirmed order's time slots remain in DB after campaign cancel."""
        space_a = _create_space(db, title="KeepSlotA")
        space_b = _create_space(db, title="KeepSlotB")
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space_a, space_b])

        # Set first order to confirmed
        _admin_set_status(client, order_ids[0], "confirmed", admin_headers)

        # Count slots for confirmed order before cancel
        slots_before = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == order_ids[0],
        ).count()
        assert slots_before > 0

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # Confirmed order's slots should still exist
        slots_after = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == order_ids[0],
        ).count()
        assert slots_after == slots_before

        # Pending order's slots should be deleted
        pending_slots = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == order_ids[1],
        ).count()
        assert pending_slots == 0

    # ── Capacity & Slots ──

    def test_cancel_frees_slots_for_multiple_spaces(self, client, db, test_user, auth_headers):
        """Campaign spanning 2 spaces at capacity. After cancel, both regain availability."""
        space_a = _create_space(db, title="MultiCapA")
        space_b = _create_space(db, title="MultiCapB")

        # Fill both spaces to capacity - 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"mcap_a_{i}@test.com")
            _book(client, space_a.id, "2025-07-01", "10:00:00", "11:00:00", h)
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"mcap_b_{i}@test.com")
            _book(client, space_b.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Create campaign that takes the last slot on both spaces
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space_a, space_b])

        # Verify both at capacity
        checker_headers, _ = _create_user_headers(client, db, "mcap_check@test.com")
        slots_a = _make_slots("2025-07-01", 10, 11)
        slots_b = _make_slots("2025-07-01", 10, 11)

        resp_a = _schedule_compat(client, space_a.id, slots_a, checker_headers)
        resp_b = _schedule_compat(client, space_b.id, slots_b, checker_headers)
        assert resp_a.json()["compatibility"] == "none"
        assert resp_b.json()["compatibility"] == "none"

        # Cancel campaign
        client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)

        # Both should be available again
        resp_a = _schedule_compat(client, space_a.id, slots_a, checker_headers)
        resp_b = _schedule_compat(client, space_b.id, slots_b, checker_headers)
        assert resp_a.json()["compatibility"] == "full"
        assert resp_b.json()["compatibility"] == "full"

    def test_cancel_approved_orders_frees_slots(self, client, db, test_user, auth_headers, admin_headers, test_admin):
        """Approved (not just pending) orders also get their time slots deleted."""
        space = _create_space(db, title="ApprSlot")

        # Fill to capacity - 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"aprslot_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Campaign with 1 order taking the last slot
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space])

        # Approve the order
        _admin_set_status(client, order_ids[0], "approved", admin_headers)

        # Verify at capacity
        checker_headers, _ = _create_user_headers(client, db, "aprslot_check@test.com")
        slots = _make_slots("2025-07-01", 10, 11)
        resp = _schedule_compat(client, space.id, slots, checker_headers)
        assert resp.json()["compatibility"] == "none"

        # Cancel campaign
        client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)

        # Should be available again
        resp = _schedule_compat(client, space.id, slots, checker_headers)
        assert resp.json()["compatibility"] == "full"

    # ── Response Shape ──

    def test_cancel_response_shape(self, client, db, test_user, auth_headers):
        """Verify response contains expected fields."""
        resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=auth_headers)
        cid = resp.json()["id"]

        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert "id" in data
        assert data["id"] == cid
        assert data["status"] == "cancelled"
        assert "campaign_type" in data
        assert "created_at" in data
        assert "updated_at" in data

    # ── Single Order Campaign ──

    def test_cancel_single_order_campaign(self, client, db, test_user, auth_headers):
        """Campaign with exactly 1 order. Cancel works, order cancelled, slots freed."""
        space = _create_space(db, title="SingleOrd")
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space])

        # Verify slot exists
        slot_count = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == order_ids[0],
        ).count()
        assert slot_count > 0

        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Order should be cancelled
        resp = client.get(f"/campaigns/{campaign_id}", headers=auth_headers)
        assert resp.json()["orders"][0]["status"] == "cancelled"

        # Slots should be freed
        slot_count = db.query(SpaceTimeSlot).filter(
            SpaceTimeSlot.order_id == order_ids[0],
        ).count()
        assert slot_count == 0

    # ── Ordering / Idempotency ──

    def test_cancel_then_rebook_same_slot(self, client, db, test_user, auth_headers):
        """Cancel campaign, then another user books the freed slot successfully."""
        space = _create_space(db, title="Rebook")

        # Fill to capacity - 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"rebook_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Campaign takes the last slot
        campaign_id, order_ids = _create_campaign_with_orders(
            client, db, auth_headers, [space])

        # Verify at capacity
        new_headers, _ = _create_user_headers(client, db, "rebook_new@test.com")
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", new_headers)
        assert resp.status_code == 409  # capacity full

        # Cancel campaign
        client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)

        # Now the new user can book
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", new_headers)
        assert resp.status_code == 201
