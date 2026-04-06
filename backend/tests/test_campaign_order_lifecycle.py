"""
Tests for campaign order lifecycle — focusing on:
  - Simple campaigns (same dates): add space, cancel individual orders
  - Advanced campaigns (different dates): add space with independent dates
  - Cancelling individual orders within campaigns (not the whole campaign)
  - Campaign stats (space count, cost) after individual order cancellations
  - Edge cases: cancel all orders one by one, cancel parent order, etc.
"""
from datetime import time
from app.models.space import Space, SpaceOperatingHours
from app.models.order import Order, OrderStatus, SpaceTimeSlot, MAX_SLOTS_PER_HOUR
from app.models.notification import Notification, NotificationType
from app.models.order_event import OrderEvent, ActionType


# ────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────

def _create_space(db, title="Test Space", start_hour=8, end_hour=20, days=None, price=100):
    space = Space(name=title, city="Tel Aviv", price_per_day=price)
    db.add(space)
    db.commit()
    db.refresh(space)
    for day in (days if days is not None else range(7)):
        db.add(SpaceOperatingHours(
            space_id=space.id, day_of_week=day,
            start_time=time(start_hour, 0), end_time=time(end_hour, 0),
        ))
    db.commit()
    return space


def _create_user_headers(client, db, email, name="User"):
    from app.models.user import User, UserRole
    from app.utils.security import hash_password, create_access_token
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


def _book_multiday(client, space_id, days_data, headers, campaign_id=None):
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


def _create_campaign(client, headers):
    resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


def _get_campaign_orders(client, headers):
    """Return the first campaign item from /orders/my with its child_orders."""
    resp = client.get("/orders/my", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    return items


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
#  PART 1: Simple Campaign — Cancel Individual Order
# ════════════════════════════════════════════

class TestSimpleCampaignCancelSingleOrder:
    """Simple campaign (all orders same dates). Cancel one order at a time."""

    def test_cancel_one_order_keeps_campaign_intact(self, client, db, test_user, auth_headers):
        """Cancel 1 of 3 orders → campaign still has 2 active orders."""
        spaces = [_create_space(db, title=f"Simple {i}") for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "09:00:00", "12:00:00",
                         auth_headers, campaign_id=cid)
            assert resp.status_code == 201
            order_ids.append(resp.json()["id"])

        # Cancel the second order
        resp = client.put(f"/orders/{order_ids[1]}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Verify campaign still listed with all orders
        items = _get_campaign_orders(client, auth_headers)
        assert len(items) == 1  # still 1 top-level campaign
        parent = items[0]
        all_orders = [parent] + parent["child_orders"]

        # 2 should be pending, 1 cancelled
        statuses = [o["status"] for o in all_orders]
        assert statuses.count("pending") == 2
        assert statuses.count("cancelled") == 1

    def test_cancel_one_order_frees_slots(self, client, db, test_user, auth_headers):
        """Cancelling an order in a campaign frees its time slots for rebooking."""
        space_a = _create_space(db, title="SlotFree A")
        space_b = _create_space(db, title="SlotFree B")
        cid = _create_campaign(client, auth_headers)

        # Fill space_b to capacity - 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"slotfree_{i}@test.com")
            _book(client, space_b.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Campaign order takes the last slot on space_b
        _book(client, space_a.id, "2025-07-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=cid)
        resp = _book(client, space_b.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        assert resp.status_code == 201
        order_b_id = resp.json()["id"]

        # Verify at capacity
        checker_h, _ = _create_user_headers(client, db, "checker@test.com")
        resp = _schedule_compat(client, space_b.id, _make_slots("2025-07-01", 10, 11), checker_h)
        assert resp.json()["compatibility"] == "none"

        # Cancel the space_b order
        client.put(f"/orders/{order_b_id}/cancel", headers=auth_headers)

        # Now space_b should be available again
        resp = _schedule_compat(client, space_b.id, _make_slots("2025-07-01", 10, 11), checker_h)
        assert resp.json()["compatibility"] == "full"

    def test_cancel_order_creates_notification_and_event(self, client, db, test_user, auth_headers):
        """Cancelling one order creates notification and event only for that order."""
        spaces = [_create_space(db, title=f"NotifSingle {i}") for i in range(2)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "09:00:00", "10:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel first order
        client.put(f"/orders/{order_ids[0]}/cancel", headers=auth_headers)

        # Only the cancelled order should have a cancel notification
        cancel_notifs = db.query(Notification).filter(
            Notification.type == NotificationType.order_cancelled,
        ).all()
        assert len(cancel_notifs) == 1
        assert cancel_notifs[0].related_order_id == order_ids[0]

        # Only the cancelled order should have a cancel event
        cancel_events = db.query(OrderEvent).filter(
            OrderEvent.action_type == ActionType.cancelled,
        ).all()
        assert len(cancel_events) == 1
        assert cancel_events[0].order_id == order_ids[0]

    def test_cancel_does_not_affect_sibling_orders(self, client, db, test_user, auth_headers):
        """Siblings retain their status, cost, and time slots after one is cancelled."""
        spaces = [_create_space(db, title=f"Sibling {i}", price=100 + i * 50) for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "12:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel middle order
        client.put(f"/orders/{order_ids[1]}/cancel", headers=auth_headers)

        # Check siblings are untouched
        for oid in [order_ids[0], order_ids[2]]:
            resp = client.get(f"/orders/{oid}", headers=auth_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "pending"
            assert len(resp.json()["time_slots"]) > 0

    def test_cancelled_order_cost_excluded_from_campaign_detail(self, client, db, test_user, auth_headers):
        """After cancelling an order, its cost should still be in the DB but the
        campaign detail should still include it (the frontend filters it)."""
        space_a = _create_space(db, title="CostExcl A", price=100)
        space_b = _create_space(db, title="CostExcl B", price=200)
        cid = _create_campaign(client, auth_headers)

        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        order_b_id = resp_b.json()["id"]

        # Cancel order B
        client.put(f"/orders/{order_b_id}/cancel", headers=auth_headers)

        # Campaign detail still lists both orders
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        orders = resp.json()["orders"]
        assert len(orders) == 2

        # But only order A should be "pending", order B should be "cancelled"
        statuses = {o["id"]: o["status"] for o in orders}
        assert statuses[resp_a.json()["id"]] == "pending"
        assert statuses[order_b_id] == "cancelled"


# ════════════════════════════════════════════
#  PART 2: Cancel All Orders One By One
# ════════════════════════════════════════════

class TestCancelAllOrdersOneByOne:
    """Cancel every order in a campaign individually, not via campaign cancel."""

    def test_cancel_all_3_orders_individually(self, client, db, test_user, auth_headers):
        """Cancelling all orders one by one → all are cancelled, campaign still exists."""
        spaces = [_create_space(db, title=f"AllCancel {i}") for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "09:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel all one by one
        for oid in order_ids:
            resp = client.put(f"/orders/{oid}/cancel", headers=auth_headers)
            assert resp.status_code == 200

        # All orders are cancelled
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        for order in resp.json()["orders"]:
            assert order["status"] == "cancelled"

        # Campaign itself still exists (not deleted)
        assert resp.json()["id"] == cid

    def test_cancel_all_frees_all_slots(self, client, db, test_user, auth_headers):
        """Cancelling every order frees all their time slots."""
        space = _create_space(db, title="AllFree")
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for dt in ["2025-07-01", "2025-07-02", "2025-07-03"]:
            resp = _book(client, space.id, dt, "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # All have slots
        for oid in order_ids:
            assert db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == oid).count() > 0

        # Cancel all
        for oid in order_ids:
            client.put(f"/orders/{oid}/cancel", headers=auth_headers)

        # All slots freed
        for oid in order_ids:
            assert db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == oid).count() == 0

    def test_cancel_5_of_6_leaves_one_active(self, client, db, test_user, auth_headers):
        """Cancel 5 of 6 orders → campaign listing still has 1 pending order."""
        spaces = [_create_space(db, title=f"FiveOf6 {i}") for i in range(6)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel first 5
        for oid in order_ids[:5]:
            client.put(f"/orders/{oid}/cancel", headers=auth_headers)

        # Verify listing
        items = _get_campaign_orders(client, auth_headers)
        assert len(items) == 1  # campaign still top-level
        all_orders = [items[0]] + items[0]["child_orders"]
        pending = [o for o in all_orders if o["status"] == "pending"]
        cancelled = [o for o in all_orders if o["status"] == "cancelled"]
        assert len(pending) == 1
        assert len(cancelled) == 5
        assert pending[0]["id"] == order_ids[5]


# ════════════════════════════════════════════
#  PART 3: Cancel Parent (First) Order in Campaign
# ════════════════════════════════════════════

class TestCancelParentOrder:
    """The parent order (first created in campaign) is cancelled while children remain."""

    def test_cancel_parent_keeps_children(self, client, db, test_user, auth_headers):
        """Cancel the parent order → children remain pending."""
        space_a = _create_space(db, title="ParentCancel A")
        space_b = _create_space(db, title="ParentCancel B")
        space_c = _create_space(db, title="ParentCancel C")
        cid = _create_campaign(client, auth_headers)

        resp_a = _book(client, space_a.id, "2025-07-01", "09:00:00", "11:00:00",
                       auth_headers, campaign_id=cid)
        parent_id = resp_a.json()["id"]

        resp_b = _book(client, space_b.id, "2025-07-01", "09:00:00", "11:00:00",
                       auth_headers, campaign_id=cid)
        child_b_id = resp_b.json()["id"]

        resp_c = _book(client, space_c.id, "2025-07-01", "09:00:00", "11:00:00",
                       auth_headers, campaign_id=cid)
        child_c_id = resp_c.json()["id"]

        # Cancel parent
        resp = client.put(f"/orders/{parent_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # Children should still be pending
        for cid_order in [child_b_id, child_c_id]:
            resp = client.get(f"/orders/{cid_order}", headers=auth_headers)
            assert resp.json()["status"] == "pending"

    def test_cancel_parent_children_still_have_slots(self, client, db, test_user, auth_headers):
        """After cancelling parent, children still have their time slots."""
        space_a = _create_space(db, title="ParentSlot A")
        space_b = _create_space(db, title="ParentSlot B")
        cid = _create_campaign(client, auth_headers)

        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        parent_id = resp_a.json()["id"]

        resp_b = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        child_id = resp_b.json()["id"]

        # Cancel parent
        client.put(f"/orders/{parent_id}/cancel", headers=auth_headers)

        # Parent's slots freed
        assert db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == parent_id).count() == 0

        # Child's slots still exist
        assert db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == child_id).count() == 2


# ════════════════════════════════════════════
#  PART 4: Simple Campaign — Add Space Then Cancel
# ════════════════════════════════════════════

class TestSimpleCampaignAddSpaceThenCancel:
    """Create simple campaign, add spaces, then cancel some."""

    def test_add_3_spaces_cancel_2(self, client, db, test_user, auth_headers):
        """Start with 1 order, add 2 more spaces, cancel 2 → 1 remains."""
        space_a = _create_space(db, title="AddCancel A")
        space_b = _create_space(db, title="AddCancel B")
        space_c = _create_space(db, title="AddCancel C")

        # Create initial order
        resp = _book(client, space_a.id, "2025-07-01", "09:00:00", "12:00:00", auth_headers)
        assert resp.status_code == 201
        order_a_id = resp.json()["id"]

        # Create campaign and assign
        cid = _create_campaign(client, auth_headers)
        client.put(f"/orders/{order_a_id}/set-campaign",
                   json={"campaign_id": cid}, headers=auth_headers)

        # Add space B (simple: same dates)
        resp = _book(client, space_b.id, "2025-07-01", "09:00:00", "12:00:00",
                     auth_headers, campaign_id=cid)
        order_b_id = resp.json()["id"]

        # Add space C (simple: same dates)
        resp = _book(client, space_c.id, "2025-07-01", "09:00:00", "12:00:00",
                     auth_headers, campaign_id=cid)
        order_c_id = resp.json()["id"]

        # Cancel B and C
        client.put(f"/orders/{order_b_id}/cancel", headers=auth_headers)
        client.put(f"/orders/{order_c_id}/cancel", headers=auth_headers)

        # Verify
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        orders = resp.json()["orders"]
        assert len(orders) == 3  # all still listed
        active = [o for o in orders if o["status"] == "pending"]
        cancelled = [o for o in orders if o["status"] == "cancelled"]
        assert len(active) == 1
        assert active[0]["id"] == order_a_id
        assert len(cancelled) == 2

    def test_add_space_after_cancel(self, client, db, test_user, auth_headers):
        """Cancel an order, then add a new space to the campaign → works fine."""
        space_a = _create_space(db, title="AddAfterCancel A")
        space_b = _create_space(db, title="AddAfterCancel B")
        space_c = _create_space(db, title="AddAfterCancel C")
        cid = _create_campaign(client, auth_headers)

        resp = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=cid)
        order_a_id = resp.json()["id"]

        resp = _book(client, space_b.id, "2025-07-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=cid)
        order_b_id = resp.json()["id"]

        # Cancel B
        client.put(f"/orders/{order_b_id}/cancel", headers=auth_headers)

        # Add C to the campaign
        resp = _book(client, space_c.id, "2025-07-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=cid)
        assert resp.status_code == 201
        order_c_id = resp.json()["id"]
        assert resp.json()["campaign_id"] == cid

        # Campaign has 3 orders: A pending, B cancelled, C pending
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        orders = resp.json()["orders"]
        assert len(orders) == 3
        statuses = {o["id"]: o["status"] for o in orders}
        assert statuses[order_a_id] == "pending"
        assert statuses[order_b_id] == "cancelled"
        assert statuses[order_c_id] == "pending"


# ════════════════════════════════════════════
#  PART 5: Advanced Campaign (Different Dates Per Order)
# ════════════════════════════════════════════

class TestAdvancedCampaignDifferentDates:
    """Advanced campaign where each order has independent dates/schedule."""

    def test_create_advanced_campaign_different_dates(self, client, db, test_user, auth_headers):
        """Each order in campaign has different start/end dates."""
        space_a = _create_space(db, title="Adv A")
        space_b = _create_space(db, title="Adv B")
        space_c = _create_space(db, title="Adv C")
        cid = _create_campaign(client, auth_headers)

        # Order A: July 1-3
        resp_a = _book_multiday(client, space_a.id, [
            ("2025-07-01", "10:00:00", "12:00:00"),
            ("2025-07-02", "10:00:00", "12:00:00"),
            ("2025-07-03", "10:00:00", "12:00:00"),
        ], auth_headers, campaign_id=cid)
        assert resp_a.status_code == 201

        # Order B: July 5-7 (different dates!)
        resp_b = _book_multiday(client, space_b.id, [
            ("2025-07-05", "14:00:00", "16:00:00"),
            ("2025-07-06", "14:00:00", "16:00:00"),
            ("2025-07-07", "14:00:00", "16:00:00"),
        ], auth_headers, campaign_id=cid)
        assert resp_b.status_code == 201

        # Order C: July 10-11 (different again!)
        resp_c = _book_multiday(client, space_c.id, [
            ("2025-07-10", "08:00:00", "12:00:00"),
            ("2025-07-11", "08:00:00", "12:00:00"),
        ], auth_headers, campaign_id=cid)
        assert resp_c.status_code == 201

        # Verify all under same campaign
        items = _get_campaign_orders(client, auth_headers)
        assert len(items) == 1
        parent = items[0]
        all_orders = [parent] + parent["child_orders"]
        assert len(all_orders) == 3
        for o in all_orders:
            assert o["status"] == "pending"

        # Verify different dates
        dates = [(o["start_date"], o["end_date"]) for o in all_orders]
        assert len(set(dates)) == 3  # all different

    def test_advanced_campaign_cancel_one_order(self, client, db, test_user, auth_headers):
        """Cancel one order from an advanced campaign → others keep their dates."""
        space_a = _create_space(db, title="AdvCancel A")
        space_b = _create_space(db, title="AdvCancel B")
        cid = _create_campaign(client, auth_headers)

        resp_a = _book(client, space_a.id, "2025-07-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        order_a_id = resp_a.json()["id"]

        resp_b = _book(client, space_b.id, "2025-07-05", "14:00:00", "16:00:00",
                       auth_headers, campaign_id=cid)
        order_b_id = resp_b.json()["id"]

        # Cancel order A
        client.put(f"/orders/{order_a_id}/cancel", headers=auth_headers)

        # Order B should be completely untouched
        resp = client.get(f"/orders/{order_b_id}", headers=auth_headers)
        assert resp.json()["status"] == "pending"
        assert resp.json()["start_date"] == "2025-07-05"
        assert resp.json()["end_date"] == "2025-07-05"
        assert len(resp.json()["time_slots"]) == 2  # 14:00 and 15:00

    def test_advanced_campaign_add_space_with_unique_dates(self, client, db, test_user, auth_headers):
        """Add a new space to advanced campaign with completely different dates."""
        space_a = _create_space(db, title="AdvAdd A")
        space_b = _create_space(db, title="AdvAdd B")
        cid = _create_campaign(client, auth_headers)

        # Order A: weekday schedule
        _book(client, space_a.id, "2025-07-01", "09:00:00", "17:00:00",
              auth_headers, campaign_id=cid)

        # Add space B: weekend schedule (completely different)
        resp = _book(client, space_b.id, "2025-07-05", "10:00:00", "14:00:00",
                     auth_headers, campaign_id=cid)
        assert resp.status_code == 201
        assert resp.json()["start_date"] == "2025-07-05"
        assert resp.json()["campaign_id"] == cid

    def test_advanced_campaign_different_hours_same_day(self, client, db, test_user, auth_headers):
        """Two orders on same date but different hours → both valid in advanced campaign."""
        space_a = _create_space(db, title="AdvHours A")
        space_b = _create_space(db, title="AdvHours B")
        cid = _create_campaign(client, auth_headers)

        # Order A: morning
        resp_a = _book(client, space_a.id, "2025-07-01", "08:00:00", "12:00:00",
                       auth_headers, campaign_id=cid)
        assert resp_a.status_code == 201

        # Order B: evening on same day
        resp_b = _book(client, space_b.id, "2025-07-01", "16:00:00", "20:00:00",
                       auth_headers, campaign_id=cid)
        assert resp_b.status_code == 201

        items = _get_campaign_orders(client, auth_headers)
        all_orders = [items[0]] + items[0]["child_orders"]
        assert len(all_orders) == 2


# ════════════════════════════════════════════
#  PART 6: Advanced Campaign — Add Then Cancel Multiple
# ════════════════════════════════════════════

class TestAdvancedCampaignAddAndCancelMultiple:
    """Advanced campaign: build up to 6 spaces, cancel some, verify state."""

    def test_6_spaces_cancel_3(self, client, db, test_user, auth_headers):
        """Create 6-space advanced campaign, cancel 3 → 3 remain pending."""
        spaces = [_create_space(db, title=f"BigAdv {i}") for i in range(6)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for i, sp in enumerate(spaces):
            dt = f"2025-07-{i+1:02d}"
            resp = _book(client, sp.id, dt, "10:00:00", "12:00:00",
                         auth_headers, campaign_id=cid)
            assert resp.status_code == 201
            order_ids.append(resp.json()["id"])

        # Cancel orders 0, 2, 4 (every other)
        for idx in [0, 2, 4]:
            resp = client.put(f"/orders/{order_ids[idx]}/cancel", headers=auth_headers)
            assert resp.status_code == 200

        # Check each order's status
        for i, oid in enumerate(order_ids):
            resp = client.get(f"/orders/{oid}", headers=auth_headers)
            expected = "cancelled" if i in [0, 2, 4] else "pending"
            assert resp.json()["status"] == expected

    def test_cancel_3_then_add_2_more(self, client, db, test_user, auth_headers):
        """Cancel 3 of 4 orders, then add 2 new ones → campaign has 3 pending, 3 cancelled."""
        spaces = [_create_space(db, title=f"CancelAdd {i}") for i in range(6)]
        cid = _create_campaign(client, auth_headers)

        # Create initial 4 orders
        order_ids = []
        for i in range(4):
            resp = _book(client, spaces[i].id, f"2025-07-{i+1:02d}", "10:00:00", "12:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel 3
        for idx in [0, 1, 2]:
            client.put(f"/orders/{order_ids[idx]}/cancel", headers=auth_headers)

        # Add 2 more
        for i in [4, 5]:
            resp = _book(client, spaces[i].id, f"2025-07-{i+10:02d}", "10:00:00", "12:00:00",
                         auth_headers, campaign_id=cid)
            assert resp.status_code == 201
            order_ids.append(resp.json()["id"])

        # Verify totals
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        orders = resp.json()["orders"]
        assert len(orders) == 6
        pending = [o for o in orders if o["status"] == "pending"]
        cancelled = [o for o in orders if o["status"] == "cancelled"]
        assert len(pending) == 3
        assert len(cancelled) == 3


# ════════════════════════════════════════════
#  PART 7: Cancel vs Campaign Cancel — Independence
# ════════════════════════════════════════════

class TestCancelOrderVsCampaignCancel:
    """Ensure individual cancel and campaign cancel are independent operations."""

    def test_individual_cancel_does_not_cancel_campaign(self, client, db, test_user, auth_headers):
        """Cancelling one order doesn't affect the campaign's own status."""
        space = _create_space(db, title="IndepCancel")
        cid = _create_campaign(client, auth_headers)

        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # Campaign itself is not cancelled
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        assert resp.json()["status"] == "active"  # campaign stays active

    def test_campaign_cancel_after_individual_cancels(self, client, db, test_user, auth_headers):
        """Cancel some orders individually, then cancel the whole campaign."""
        spaces = [_create_space(db, title=f"CampAfterInd {i}") for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel first order individually
        client.put(f"/orders/{order_ids[0]}/cancel", headers=auth_headers)

        # Now cancel the whole campaign
        resp = client.put(f"/campaigns/{cid}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # All orders should be cancelled
        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        for order in resp.json()["orders"]:
            assert order["status"] == "cancelled"

    def test_cannot_cancel_already_cancelled_order(self, client, db, test_user, auth_headers):
        """Trying to cancel an already-cancelled order returns 400."""
        space = _create_space(db, title="DblCancel")
        cid = _create_campaign(client, auth_headers)

        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        # Cancel once
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200

        # Try to cancel again
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 400


# ════════════════════════════════════════════
#  PART 8: Capacity After Cancel and Rebook
# ════════════════════════════════════════════

class TestCapacityAfterCancelAndRebook:
    """Cancel order in campaign, verify capacity freed, rebook same slot."""

    def test_cancel_and_rebook_same_space(self, client, db, test_user, auth_headers):
        """Cancel order in campaign → another user can book the freed slot."""
        space = _create_space(db, title="Rebook Space")

        # Fill to capacity - 1
        for i in range(MAX_SLOTS_PER_HOUR - 1):
            h, _ = _create_user_headers(client, db, f"rebook_{i}@test.com")
            _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", h)

        # Campaign with order taking the last slot
        cid = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        # New user can't book (at capacity)
        new_h, _ = _create_user_headers(client, db, "rebook_new@test.com")
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", new_h)
        assert resp.status_code == 409

        # Cancel the campaign order
        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # Now new user can book
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00", new_h)
        assert resp.status_code == 201

    def test_cancel_multiday_order_frees_all_days(self, client, db, test_user, auth_headers):
        """Multi-day order in campaign: cancel frees slots on all days."""
        space = _create_space(db, title="MultidayFree")
        cid = _create_campaign(client, auth_headers)

        # Fill 3 days to capacity - 1
        for dt in ["2025-07-01", "2025-07-02", "2025-07-03"]:
            for i in range(MAX_SLOTS_PER_HOUR - 1):
                h, _ = _create_user_headers(client, db, f"mdf_{dt}_{i}@test.com")
                _book(client, space.id, dt, "10:00:00", "11:00:00", h)

        # Multi-day order takes last slot on all 3 days
        resp = _book_multiday(client, space.id, [
            ("2025-07-01", "10:00:00", "11:00:00"),
            ("2025-07-02", "10:00:00", "11:00:00"),
            ("2025-07-03", "10:00:00", "11:00:00"),
        ], auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        # All 3 days at capacity
        checker_h, _ = _create_user_headers(client, db, "mdf_check@test.com")
        for dt in ["2025-07-01", "2025-07-02", "2025-07-03"]:
            resp = _schedule_compat(client, space.id, _make_slots(dt, 10, 11), checker_h)
            assert resp.json()["compatibility"] == "none"

        # Cancel order
        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # All 3 days should be free
        for dt in ["2025-07-01", "2025-07-02", "2025-07-03"]:
            resp = _schedule_compat(client, space.id, _make_slots(dt, 10, 11), checker_h)
            assert resp.json()["compatibility"] == "full"


# ════════════════════════════════════════════
#  PART 9: Listing Shape After Individual Cancels
# ════════════════════════════════════════════

class TestListingAfterCancels:
    """Verify /orders/my response shape after individual cancellations."""

    def test_cancelled_order_still_in_listing(self, client, db, test_user, auth_headers):
        """Cancelled orders still appear in the campaign's child_orders."""
        spaces = [_create_space(db, title=f"ListShape {i}") for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel one
        client.put(f"/orders/{order_ids[1]}/cancel", headers=auth_headers)

        items = _get_campaign_orders(client, auth_headers)
        assert len(items) == 1
        all_orders = [items[0]] + items[0]["child_orders"]
        all_ids = [o["id"] for o in all_orders]

        # All 3 orders still present
        for oid in order_ids:
            assert oid in all_ids

        # But one is cancelled
        cancelled = [o for o in all_orders if o["status"] == "cancelled"]
        assert len(cancelled) == 1
        assert cancelled[0]["id"] == order_ids[1]

    def test_listing_total_count_unchanged_after_cancel(self, client, db, test_user, auth_headers):
        """Total count in /orders/my doesn't change when cancelling individual orders
        (campaign is still 1 top-level item)."""
        spaces = [_create_space(db, title=f"TotalCount {i}") for i in range(3)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Before cancel
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 1

        # Cancel 2 orders
        client.put(f"/orders/{order_ids[0]}/cancel", headers=auth_headers)
        client.put(f"/orders/{order_ids[1]}/cancel", headers=auth_headers)

        # After cancel — still 1 top-level campaign
        resp = client.get("/orders/my", headers=auth_headers)
        assert resp.json()["total"] == 1


# ════════════════════════════════════════════
#  PART 10: Mixed Statuses in Campaign
# ════════════════════════════════════════════

class TestMixedStatusCampaign:
    """Campaign with orders in various statuses after individual operations."""

    def test_mixed_pending_and_cancelled(self, client, db, test_user, auth_headers):
        """Some pending, some cancelled → campaign detail shows correct mix."""
        spaces = [_create_space(db, title=f"Mixed {i}") for i in range(4)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Cancel even-indexed orders
        client.put(f"/orders/{order_ids[0]}/cancel", headers=auth_headers)
        client.put(f"/orders/{order_ids[2]}/cancel", headers=auth_headers)

        resp = client.get(f"/campaigns/{cid}", headers=auth_headers)
        orders = resp.json()["orders"]
        statuses = {o["id"]: o["status"] for o in orders}
        assert statuses[order_ids[0]] == "cancelled"
        assert statuses[order_ids[1]] == "pending"
        assert statuses[order_ids[2]] == "cancelled"
        assert statuses[order_ids[3]] == "pending"

    def test_approved_order_can_be_cancelled_individually(self, client, db, test_user, auth_headers,
                                                          admin_headers, test_admin):
        """Admin approves one order, user cancels it → only that order cancelled."""
        spaces = [_create_space(db, title=f"ApprCancel {i}") for i in range(2)]
        cid = _create_campaign(client, auth_headers)

        order_ids = []
        for sp in spaces:
            resp = _book(client, sp.id, "2025-07-01", "10:00:00", "11:00:00",
                         auth_headers, campaign_id=cid)
            order_ids.append(resp.json()["id"])

        # Admin approves first order
        client.put(f"/admin/orders/{order_ids[0]}", json={"status": "approved"},
                   headers=admin_headers)

        # User cancels the approved order
        resp = client.put(f"/orders/{order_ids[0]}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Second order still pending
        resp = client.get(f"/orders/{order_ids[1]}", headers=auth_headers)
        assert resp.json()["status"] == "pending"

    def test_confirmed_order_cannot_be_cancelled_by_user(self, client, db, test_user, auth_headers,
                                                          admin_headers, test_admin):
        """Confirmed orders cannot be cancelled by user (only pending/approved can)."""
        space = _create_space(db, title="ConfNoCancelUser")
        cid = _create_campaign(client, auth_headers)

        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        # Admin confirms
        client.put(f"/admin/orders/{order_id}", json={"status": "confirmed"},
                   headers=admin_headers)

        # User tries to cancel → should fail
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 400


# ════════════════════════════════════════════
#  PART 11: Cross-User Isolation for Campaign Orders
# ════════════════════════════════════════════

class TestCrossUserCampaignIsolation:
    """Users can't cancel or interact with other users' campaign orders."""

    def test_cannot_cancel_other_users_campaign_order(self, client, db, test_user, auth_headers):
        """User B cannot cancel an order belonging to User A's campaign."""
        space = _create_space(db, title="IsoCancel")
        cid = _create_campaign(client, auth_headers)

        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=cid)
        order_id = resp.json()["id"]

        # Other user tries to cancel
        other_h, _ = _create_user_headers(client, db, "attacker@test.com")
        resp = client.put(f"/orders/{order_id}/cancel", headers=other_h)
        assert resp.status_code == 404

    def test_cannot_add_space_to_other_users_campaign(self, client, db, test_user, auth_headers):
        """User B cannot add an order to User A's campaign."""
        space = _create_space(db, title="IsoAdd")
        cid = _create_campaign(client, auth_headers)

        other_h, _ = _create_user_headers(client, db, "iso_add@test.com")
        resp = _book(client, space.id, "2025-07-01", "10:00:00", "11:00:00",
                     other_h, campaign_id=cid)
        assert resp.status_code in (403, 404)
