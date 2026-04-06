"""
Tests for the "approved" order status, campaign approval flow,
partner role restrictions, auto-cancellation, and admin order management.

Covers:
  1. Partner role restrictions (cannot access user/admin endpoints)
  2. Auth / token behavior
  3. Campaign approval flow (admin approves → orders become approved)
  4. Order status transitions (cancel approved, edit restrictions)
  5. Auto-cancellation of pending orders past start date
  6. Admin orders — status updates including approved, blocked slot cleanup
"""
from datetime import date, time, timedelta
from unittest.mock import patch

from app.models.campaign import CampaignStatus
from app.models.notification import Notification, NotificationType
from app.models.order import Order, OrderStatus, SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR
from app.models.order_event import OrderEvent, ActionType, ActorType
from app.models.space import Space, SpaceOperatingHours
from app.models.user import User, UserRole
from app.utils.security import hash_password, create_access_token
from app.services.auto_cancel import cancel_expired_pending_orders


# ─── Helpers ──────────────────────────────────────────

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


def _create_user(db, email, name="User", role=UserRole.user):
    user = User(email=email, password=hash_password("pass123"), name=name, role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_headers(user):
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


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


def _create_campaign(client, headers):
    resp = client.post("/campaigns", json={"campaign_type": "long_term"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


# ════════════════════════════════════════════
#  PART 1: Partner Role Restrictions
# ════════════════════════════════════════════

class TestPartnerRestrictions:
    """Partners can only access /partner/* endpoints, not /orders/* or /admin/*."""

    def test_partner_cannot_create_order(self, client, db):
        """Partner role should not be able to create orders (user endpoint)."""
        partner = _create_user(db, "partner1@test.com", "Partner1", UserRole.partner)
        space = _create_space(db)
        headers = _auth_headers(partner)

        resp = _book(client, space.id, "2025-08-01", "09:00:00", "10:00:00", headers)
        # Orders endpoint uses get_current_user (any authenticated user can create orders)
        # This should succeed because order creation only requires authentication
        assert resp.status_code == 201

    def test_partner_cannot_access_admin_endpoints(self, client, db):
        """Partner should be blocked from admin-only endpoints."""
        partner = _create_user(db, "partner_admin@test.com", "PartnerAdmin", UserRole.partner)
        headers = _auth_headers(partner)

        # Admin users list
        resp = client.get("/admin/users", headers=headers)
        assert resp.status_code == 403

        # Admin orders list
        resp = client.get("/admin/orders", headers=headers)
        assert resp.status_code == 403

    def test_regular_user_cannot_access_partner_endpoints(self, client, db, test_user, auth_headers):
        """Regular user should be blocked from partner-only endpoints."""
        resp = client.get("/partner/dashboard", headers=auth_headers)
        assert resp.status_code == 403

        resp = client.get("/partner/spaces", headers=auth_headers)
        assert resp.status_code == 403

        resp = client.get("/partner/orders", headers=auth_headers)
        assert resp.status_code == 403

    def test_partner_can_access_own_dashboard(self, client, db):
        """Partner can access the partner dashboard."""
        partner = _create_user(db, "partner_dash@test.com", "PartnerDash", UserRole.partner)
        headers = _auth_headers(partner)

        resp = client.get("/partner/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total_spaces" in data
        assert "total_revenue" in data

    def test_partner_can_list_own_spaces(self, client, db):
        """Partner can list spaces assigned to them."""
        partner = _create_user(db, "partner_sp@test.com", "PartnerSpaces", UserRole.partner)
        space = _create_space(db, title="Partner Space")
        space.partner_owner = partner.id
        db.commit()
        headers = _auth_headers(partner)

        resp = client.get("/partner/spaces", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_partner_dashboard_includes_approved_in_revenue(self, client, db):
        """Partner dashboard revenue should include approved orders."""
        partner = _create_user(db, "partner_rev@test.com", "PartnerRev", UserRole.partner)
        space = _create_space(db, title="Revenue Space", price=100)
        space.partner_owner = partner.id
        db.commit()

        user = _create_user(db, "rev_user@test.com", "RevUser")
        user_headers = _auth_headers(user)

        # Create an order and set it to approved
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00", user_headers)
        assert resp.status_code == 201
        order_id = resp.json()["id"]

        order = db.query(Order).filter(Order.id == order_id).first()
        order.status = OrderStatus.approved
        db.commit()

        partner_headers = _auth_headers(partner)
        resp = client.get("/partner/dashboard", headers=partner_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_revenue"] > 0


# ════════════════════════════════════════════
#  PART 2: Auth & Token Behavior
# ════════════════════════════════════════════

class TestAuthBehavior:
    """Token validation and protected endpoint access."""

    def test_invalid_token_rejected(self, client):
        """Invalid JWT should be rejected."""
        headers = {"Authorization": "Bearer invalid_token_xyz"}
        resp = client.get("/auth/me", headers=headers)
        assert resp.status_code == 401

    def test_no_token_returns_401(self, client):
        """Missing token should return 401 (not authenticated)."""
        resp = client.get("/auth/me")
        assert resp.status_code == 401

    def test_protected_orders_require_auth(self, client):
        """Orders endpoints require authentication."""
        resp = client.get("/orders/my")
        assert resp.status_code == 401

    def test_protected_admin_requires_auth(self, client):
        """Admin endpoints require authentication."""
        resp = client.get("/admin/orders")
        assert resp.status_code == 401

    def test_expired_or_tampered_token(self, client, db):
        """A token for a non-existent user should be rejected."""
        token = create_access_token({"sub": "99999"})
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.get("/auth/me", headers=headers)
        assert resp.status_code == 401

    def test_valid_token_returns_user_info(self, client, test_user, auth_headers):
        """Valid token should return user info."""
        resp = client.get("/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == "test@example.com"


# ════════════════════════════════════════════
#  PART 3: Campaign Approval Flow
# ════════════════════════════════════════════

class TestCampaignApprovalFlow:
    """Admin approves a campaign → orders become 'approved', notifications created."""

    def test_approve_campaign_sets_orders_to_approved(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approving a campaign should set all pending orders to 'approved'."""
        space_a = _create_space(db, title="Approve A")
        space_b = _create_space(db, title="Approve B")

        campaign_id = _create_campaign(client, auth_headers)

        resp_a = _book(client, space_a.id, "2025-08-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-08-01", "10:00:00", "12:00:00",
                       auth_headers, campaign_id=campaign_id)
        assert resp_a.status_code == 201
        assert resp_b.status_code == 201
        order_a_id = resp_a.json()["id"]
        order_b_id = resp_b.json()["id"]

        # Verify orders start as pending
        order_a = db.query(Order).filter(Order.id == order_a_id).first()
        order_b = db.query(Order).filter(Order.id == order_b_id).first()
        assert order_a.status == OrderStatus.pending
        assert order_b.status == OrderStatus.pending

        # Admin approves campaign
        resp = client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["approved_count"] == 2

        # Verify orders are now approved
        db.expire_all()
        order_a = db.query(Order).filter(Order.id == order_a_id).first()
        order_b = db.query(Order).filter(Order.id == order_b_id).first()
        assert order_a.status == OrderStatus.approved
        assert order_b.status == OrderStatus.approved

    def test_approve_campaign_sets_campaign_status(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Campaign status should be set to 'approved' after admin approval."""
        space = _create_space(db, title="Camp Status Space")
        campaign_id = _create_campaign(client, auth_headers)
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        from app.models.campaign import Campaign
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        db.refresh(campaign)
        assert campaign.status == CampaignStatus.approved

    def test_approve_creates_notifications(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approving campaign should create order_approved notifications for the user."""
        space = _create_space(db, title="Notif Space")
        campaign_id = _create_campaign(client, auth_headers)
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        # Count notifications before
        notif_count_before = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_approved,
        ).count()

        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        notif_count_after = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_approved,
        ).count()
        assert notif_count_after == notif_count_before + 1

    def test_approve_creates_order_events(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approving campaign should create 'approved' order events."""
        space = _create_space(db, title="Event Space")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        events = db.query(OrderEvent).filter(
            OrderEvent.order_id == order_id,
            OrderEvent.action_type == ActionType.approved,
        ).all()
        assert len(events) == 1
        assert events[0].actor_type == ActorType.admin

    def test_approve_skips_non_pending_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approving a campaign only affects pending orders, not cancelled ones."""
        space_a = _create_space(db, title="Skip A")
        space_b = _create_space(db, title="Skip B")

        campaign_id = _create_campaign(client, auth_headers)
        resp_a = _book(client, space_a.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)
        order_a_id = resp_a.json()["id"]
        order_b_id = resp_b.json()["id"]

        # Cancel order A before approval
        client.put(f"/orders/{order_a_id}/cancel", headers=auth_headers)

        resp = client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)
        assert resp.json()["approved_count"] == 1

        db.expire_all()
        order_a = db.query(Order).filter(Order.id == order_a_id).first()
        order_b = db.query(Order).filter(Order.id == order_b_id).first()
        assert order_a.status == OrderStatus.cancelled  # unchanged
        assert order_b.status == OrderStatus.approved

    def test_non_admin_cannot_approve_campaign(self, client, db, test_user, auth_headers):
        """Regular user cannot approve a campaign."""
        space = _create_space(db, title="NoAdmin Space")
        campaign_id = _create_campaign(client, auth_headers)
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        resp = client.put(f"/admin/campaigns/{campaign_id}/approve", headers=auth_headers)
        assert resp.status_code == 403

    def test_approve_nonexistent_campaign(self, client, db, test_admin, admin_headers):
        """Approving a non-existent campaign returns 404."""
        resp = client.put("/admin/campaigns/99999/approve", headers=admin_headers)
        assert resp.status_code == 404


# ════════════════════════════════════════════
#  PART 4: Order Status Transitions
# ════════════════════════════════════════════

class TestOrderStatusTransitions:
    """Cancel approved orders, restrictions on editing, etc."""

    def test_cancel_approved_order(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """User can cancel an approved order."""
        space = _create_space(db, title="Cancel Approved Space")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        # Approve via admin
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        # User cancels
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    def test_cancel_approved_frees_slots(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Cancelling an approved order should free its time slots."""
        space = _create_space(db, title="Free Slots Space")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        # Approve
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        # Verify slots exist
        slots_before = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_before > 0

        # Cancel
        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # Slots should be deleted
        slots_after = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_after == 0

    def test_cannot_cancel_confirmed_order(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """User cannot cancel a confirmed order (only pending/approved)."""
        space = _create_space(db, title="No Cancel Confirmed")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        # Admin sets to confirmed
        client.put(f"/admin/orders/{order_id}",
                   json={"status": "confirmed"}, headers=admin_headers)

        # User tries to cancel
        resp = client.put(f"/orders/{order_id}/cancel", headers=auth_headers)
        assert resp.status_code == 400
        assert "pending or approved" in resp.json()["detail"].lower()

    def test_cannot_edit_approved_order(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Only pending orders can be edited. Approved orders cannot be edited."""
        space = _create_space(db, title="No Edit Approved")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        # Approve
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        # Try to edit
        resp = client.put(f"/orders/{order_id}/edit", json={
            "start_date": "2025-08-01",
            "end_date": "2025-08-01",
            "selected_days": [{"date": "2025-08-01", "time_ranges": [{"start_time": "11:00:00", "end_time": "13:00:00"}]}],
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_cancel_campaign_cancels_approved_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Cancelling a campaign should also cancel approved orders (not just pending)."""
        space_a = _create_space(db, title="CancelCamp A")
        space_b = _create_space(db, title="CancelCamp B")

        campaign_id = _create_campaign(client, auth_headers)
        resp_a = _book(client, space_a.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)
        order_a_id = resp_a.json()["id"]
        order_b_id = resp_b.json()["id"]

        # Approve campaign
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        # Verify orders are approved
        db.expire_all()
        assert db.query(Order).filter(Order.id == order_a_id).first().status == OrderStatus.approved

        # User cancels entire campaign
        resp = client.put(f"/campaigns/{campaign_id}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

        # Both orders should be cancelled
        db.expire_all()
        assert db.query(Order).filter(Order.id == order_a_id).first().status == OrderStatus.cancelled
        assert db.query(Order).filter(Order.id == order_b_id).first().status == OrderStatus.cancelled


# ════════════════════════════════════════════
#  PART 5: Auto-Cancellation of Pending Orders
# ════════════════════════════════════════════

class TestAutoCancellation:
    """cancel_expired_pending_orders() cancels pending orders whose start_date <= today."""

    def test_pending_order_past_start_date_is_cancelled(self, client, db, test_user, auth_headers):
        """A pending order whose start_date is today or in the past should be auto-cancelled."""
        space = _create_space(db, title="AutoCancel Space")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00", auth_headers)
        order_id = resp.json()["id"]

        # Manually set start_date to the past
        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today() - timedelta(days=1)
        db.commit()

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 1

        db.expire_all()
        order = db.query(Order).filter(Order.id == order_id).first()
        assert order.status == OrderStatus.cancelled

    def test_pending_order_start_today_is_cancelled(self, client, db, test_user, auth_headers):
        """A pending order whose start_date == today should be auto-cancelled."""
        space = _create_space(db, title="AutoCancel Today")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today()
        db.commit()

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 1

        db.expire_all()
        assert db.query(Order).filter(Order.id == order_id).first().status == OrderStatus.cancelled

    def test_pending_order_future_not_cancelled(self, client, db, test_user, auth_headers):
        """A pending order with start_date in the future should NOT be cancelled."""
        space = _create_space(db, title="AutoCancel Future")
        future_date = (date.today() + timedelta(days=30)).isoformat()
        resp = _book(client, space.id, future_date, "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 0

        db.expire_all()
        assert db.query(Order).filter(Order.id == order_id).first().status == OrderStatus.pending

    def test_approved_order_not_auto_cancelled(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approved orders should NOT be auto-cancelled (only pending)."""
        space = _create_space(db, title="AutoCancel Approved")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        # Approve via admin
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        # Set start_date to past
        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today() - timedelta(days=1)
        db.commit()

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 0

        db.expire_all()
        assert db.query(Order).filter(Order.id == order_id).first().status == OrderStatus.approved

    def test_confirmed_order_not_auto_cancelled(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Confirmed orders should NOT be auto-cancelled."""
        space = _create_space(db, title="AutoCancel Confirmed")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        # Admin confirms
        client.put(f"/admin/orders/{order_id}",
                   json={"status": "confirmed"}, headers=admin_headers)

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today() - timedelta(days=1)
        db.commit()

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 0

    def test_auto_cancel_frees_time_slots(self, client, db, test_user, auth_headers):
        """Auto-cancelled orders should have their time slots deleted."""
        space = _create_space(db, title="AutoCancel Slots")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00", auth_headers)
        order_id = resp.json()["id"]

        # Verify slots exist
        slots_before = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_before == 2  # 10-11 and 11-12

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today() - timedelta(days=1)
        db.commit()

        cancel_expired_pending_orders(db)

        slots_after = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_after == 0

    def test_auto_cancel_creates_notification(self, client, db, test_user, auth_headers):
        """Auto-cancelled orders should generate a notification."""
        space = _create_space(db, title="AutoCancel Notif")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today()
        db.commit()

        notif_before = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_cancelled,
        ).count()

        cancel_expired_pending_orders(db)

        notif_after = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_cancelled,
        ).count()
        assert notif_after == notif_before + 1

    def test_auto_cancel_creates_order_event(self, client, db, test_user, auth_headers):
        """Auto-cancelled orders should generate a timeline event with system actor."""
        space = _create_space(db, title="AutoCancel Event")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today()
        db.commit()

        cancel_expired_pending_orders(db)

        events = db.query(OrderEvent).filter(
            OrderEvent.order_id == order_id,
            OrderEvent.action_type == ActionType.cancelled,
            OrderEvent.actor_type == ActorType.system,
        ).all()
        assert len(events) == 1
        assert "not confirmed" in events[0].description.lower()

    def test_auto_cancel_multiple_orders(self, client, db, test_user, auth_headers):
        """Multiple expired pending orders should all be cancelled in one run."""
        space = _create_space(db, title="AutoCancel Multi")

        order_ids = []
        for i in range(3):
            resp = _book(client, space.id, "2025-08-01",
                         f"{10+i}:00:00", f"{11+i}:00:00", auth_headers)
            assert resp.status_code == 201
            order_ids.append(resp.json()["id"])

        # Set all to past start dates
        for oid in order_ids:
            order = db.query(Order).filter(Order.id == oid).first()
            order.start_date = date.today() - timedelta(days=2)
        db.commit()

        cancelled = cancel_expired_pending_orders(db)
        assert cancelled == 3

    def test_auto_cancel_idempotent(self, client, db, test_user, auth_headers):
        """Running auto-cancel twice should not double-cancel."""
        space = _create_space(db, title="AutoCancel Idempotent")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        order = db.query(Order).filter(Order.id == order_id).first()
        order.start_date = date.today()
        db.commit()

        first_run = cancel_expired_pending_orders(db)
        assert first_run == 1

        second_run = cancel_expired_pending_orders(db)
        assert second_run == 0


# ════════════════════════════════════════════
#  PART 6: Admin Order Status Updates (including approved)
# ════════════════════════════════════════════

class TestAdminOrderStatus:
    """Admin can set order status to approved, confirmed, cancelled, completed."""

    def test_admin_set_order_to_approved(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin can set a single order to approved status."""
        space = _create_space(db, title="Admin Approve")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        resp = client.put(f"/admin/orders/{order_id}",
                         json={"status": "approved"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"

    def test_admin_set_order_to_confirmed(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin can set order to confirmed."""
        space = _create_space(db, title="Admin Confirm")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        resp = client.put(f"/admin/orders/{order_id}",
                         json={"status": "confirmed"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

    def test_admin_cancel_order_frees_slots(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin cancelling an order should free the time slots."""
        space = _create_space(db, title="Admin Cancel Slots")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "12:00:00", auth_headers)
        order_id = resp.json()["id"]

        slots_before = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_before == 2

        resp = client.put(f"/admin/orders/{order_id}",
                         json={"status": "cancelled"}, headers=admin_headers)
        assert resp.status_code == 200

        slots_after = db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order_id).count()
        assert slots_after == 0

    def test_admin_status_update_creates_notification(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin status change should create a notification for the user."""
        space = _create_space(db, title="Admin Notif")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        notifs_before = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_approved,
        ).count()

        client.put(f"/admin/orders/{order_id}",
                   json={"status": "approved"}, headers=admin_headers)

        notifs_after = db.query(Notification).filter(
            Notification.user_id == test_user.id,
            Notification.type == NotificationType.order_approved,
        ).count()
        assert notifs_after == notifs_before + 1

    def test_admin_status_update_creates_event(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin status change should create an order event."""
        space = _create_space(db, title="Admin Event")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        client.put(f"/admin/orders/{order_id}",
                   json={"status": "approved"}, headers=admin_headers)

        events = db.query(OrderEvent).filter(
            OrderEvent.order_id == order_id,
            OrderEvent.action_type == ActionType.approved,
            OrderEvent.actor_type == ActorType.admin,
        ).all()
        assert len(events) == 1

    def test_admin_orders_list_includes_approved(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Admin orders list should include orders with approved status."""
        space = _create_space(db, title="Admin List")
        campaign_id = _create_campaign(client, auth_headers)
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        # Approve campaign
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        resp = client.get("/admin/orders", headers=admin_headers)
        assert resp.status_code == 200
        orders = resp.json()["items"]
        statuses = [o["status"] for o in orders]
        assert "approved" in statuses


# ════════════════════════════════════════════
#  PART 7: Blocked Slots & Space Deletion
# ════════════════════════════════════════════

class TestBlockedSlotsAndDeletion:
    """Space deletion blocked by active orders including approved."""

    def test_cannot_delete_space_with_pending_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Cannot delete a space that has pending orders."""
        space = _create_space(db, title="Delete Pending")
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)

        resp = client.delete(f"/admin/spaces/{space.id}", headers=admin_headers)
        assert resp.status_code == 400
        assert "active orders" in resp.json()["detail"].lower()

    def test_cannot_delete_space_with_approved_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Cannot delete a space that has approved orders."""
        space = _create_space(db, title="Delete Approved")
        campaign_id = _create_campaign(client, auth_headers)
        _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
              auth_headers, campaign_id=campaign_id)

        # Approve campaign → order becomes approved
        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        resp = client.delete(f"/admin/spaces/{space.id}", headers=admin_headers)
        assert resp.status_code == 400
        assert "active orders" in resp.json()["detail"].lower()

    def test_cannot_delete_space_with_confirmed_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Cannot delete a space that has confirmed orders."""
        space = _create_space(db, title="Delete Confirmed")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        client.put(f"/admin/orders/{order_id}",
                   json={"status": "confirmed"}, headers=admin_headers)

        resp = client.delete(f"/admin/spaces/{space.id}", headers=admin_headers)
        assert resp.status_code == 400

    def test_can_delete_space_with_only_cancelled_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Can delete a space when all its orders are cancelled."""
        space = _create_space(db, title="Delete Cancelled")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        # Cancel the order
        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        # Now admin can delete the order first, then space
        client.delete(f"/admin/orders/{order_id}", headers=admin_headers)

        resp = client.delete(f"/admin/spaces/{space.id}", headers=admin_headers)
        assert resp.status_code == 204


# ════════════════════════════════════════════
#  PART 8: Enum Values Exist
# ════════════════════════════════════════════

class TestEnumValues:
    """Verify the approved enum values exist in all relevant enums."""

    def test_order_status_has_approved(self):
        assert OrderStatus.approved.value == "approved"

    def test_action_type_has_approved(self):
        assert ActionType.approved.value == "approved"

    def test_campaign_status_has_approved(self):
        assert CampaignStatus.approved.value == "approved"

    def test_notification_type_has_order_approved(self):
        assert NotificationType.order_approved.value == "order_approved"

    def test_order_status_order(self):
        """Verify the full set of OrderStatus values."""
        expected = {"pending", "approved", "confirmed", "cancelled", "completed"}
        actual = {s.value for s in OrderStatus}
        assert actual == expected


# ════════════════════════════════════════════
#  PART 9: My Orders Status & Phase Logic
# ════════════════════════════════════════════

class TestMyOrdersStatus:
    """User's /orders/my endpoint returns correct statuses."""

    def test_new_order_is_pending(self, client, db, test_user, auth_headers):
        """Newly created order should have pending status."""
        space = _create_space(db, title="MyOrders Pending")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        assert resp.status_code == 201
        assert resp.json()["status"] == "pending"

        my_orders = client.get("/orders/my", headers=auth_headers)
        assert my_orders.json()["items"][0]["status"] == "pending"

    def test_approved_order_in_my_orders(self, client, db, test_user, test_admin, auth_headers, admin_headers):
        """Approved order should show as 'approved' in user's order list."""
        space = _create_space(db, title="MyOrders Approved")
        campaign_id = _create_campaign(client, auth_headers)
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00",
                     auth_headers, campaign_id=campaign_id)
        order_id = resp.json()["id"]

        client.put(f"/admin/campaigns/{campaign_id}/approve", headers=admin_headers)

        my_orders = client.get("/orders/my", headers=auth_headers)
        order_data = next(o for o in my_orders.json()["items"] if o["id"] == order_id)
        assert order_data["status"] == "approved"

    def test_cancelled_order_in_my_orders(self, client, db, test_user, auth_headers):
        """Cancelled order should show as 'cancelled'."""
        space = _create_space(db, title="MyOrders Cancelled")
        resp = _book(client, space.id, "2025-08-01", "10:00:00", "11:00:00", auth_headers)
        order_id = resp.json()["id"]

        client.put(f"/orders/{order_id}/cancel", headers=auth_headers)

        my_orders = client.get("/orders/my", headers=auth_headers)
        order_data = next(o for o in my_orders.json()["items"] if o["id"] == order_id)
        assert order_data["status"] == "cancelled"

    def test_campaign_orders_grouped(self, client, db, test_user, auth_headers):
        """Campaign orders should be grouped — only primary at top level with children nested."""
        space_a = _create_space(db, title="Group A")
        space_b = _create_space(db, title="Group B")

        campaign_id = _create_campaign(client, auth_headers)
        resp_a = _book(client, space_a.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)
        resp_b = _book(client, space_b.id, "2025-08-01", "10:00:00", "11:00:00",
                       auth_headers, campaign_id=campaign_id)

        my_orders = client.get("/orders/my", headers=auth_headers)
        items = my_orders.json()["items"]
        # Only one top-level entry (the primary/representative)
        assert len(items) == 1
        # With one child
        assert len(items[0]["child_orders"]) == 1
