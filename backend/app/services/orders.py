import math
import uuid
import logging
from decimal import Decimal
from collections import defaultdict
from sqlalchemy import func, and_, tuple_
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from datetime import time as dt_time
from app.models.order import Order, SpaceTimeSlot, OrderCreative, SlotStatus, OrderStatus, BookingType, MAX_SLOTS_PER_HOUR
from app.models.campaign import Campaign
from app.models.recurring_schedule import RecurringSchedule
from app.models.schedule_override import ScheduleOverride, OverrideType
from app.models.space import Space, SpaceOperatingHours
from app.models.user import User
from app.schemas.order import OrderCreate, ScheduleOverrideCreate, RecurringScheduleEntry
from app.models.notification import NotificationType
from app.services.notifications import create_notification
from app.models.order_event import ActionType, ActorType
from app.services.order_events import create_order_event
from app.services.schedule_materializer import materialize_schedule
from app.services.email import send_booking_created_emails

logger = logging.getLogger(__name__)


def _compute_prorated_cost(selected_days, space) -> Decimal:
    """Compute total cost using prorated daily rate.

    Formula per date: (price_per_day / total_operating_hours) * selected_hours.
    If operating hours are not found for a day, fall back to selected hours as denominator.
    """
    # Build lookup: day_of_week (0=Sun) → bookable whole-hour slots.
    # Use ceil(start) and floor(end) so that booking all available slots
    # equals exactly price_per_day (slots are always whole hours).
    oh_map: dict[int, Decimal] = {}
    for oh in space.operating_hours:
        start_h = math.ceil(oh.start_time.hour + oh.start_time.minute / 60)
        end_h = math.floor(oh.end_time.hour + oh.end_time.minute / 60)
        oh_map[oh.day_of_week] = Decimal(max(end_h - start_h, 1))

    logger.info(
        "Prorated cost: space_id=%s price_per_day=%s oh_map=%s num_days=%d",
        space.id, space.price_per_day, oh_map, len(selected_days),
    )

    total_cost = Decimal(0)
    for day in selected_days:
        day_hours = Decimal(0)
        for tr in day.time_ranges:
            start_h = Decimal(tr.start_time.hour) + Decimal(tr.start_time.minute) / Decimal(60)
            end_h = Decimal(tr.end_time.hour) + Decimal(tr.end_time.minute) / Decimal(60)
            day_hours += end_h - start_h
        # Convert Python weekday (Mon=0) to our convention (Sun=0)
        py_weekday = day.date.weekday()  # Mon=0 ... Sun=6
        dow = (py_weekday + 1) % 7       # Sun=0 ... Sat=6
        daily_op_hours = oh_map.get(dow, day_hours) or day_hours or Decimal(1)
        day_cost = (space.price_per_day / daily_op_hours) * day_hours
        logger.debug(
            "  date=%s dow=%d day_hours=%s daily_op_hours=%s day_cost=%s",
            day.date, dow, day_hours, daily_op_hours, day_cost,
        )
        total_cost += day_cost
    logger.info("Prorated cost result: total_cost=%s", total_cost)
    return total_cost


def _resolve_selected_days(data):
    """Normalize input to selected_days regardless of booking type."""
    if data.booking_type == "long_term":
        # Accept selected_days directly (frontend materializes the schedule),
        # or fall back to materializing from recurring_schedule
        if data.selected_days:
            return data.selected_days
        if data.recurring_schedule:
            return materialize_schedule(data.recurring_schedule, [], data.start_date, data.end_date)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="selected_days or recurring_schedule required for long_term bookings",
        )
    else:
        if not data.selected_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="selected_days required for bookings",
            )
        return data.selected_days


def _break_into_hourly_slots(start_time, end_time):
    """Break a time range into per-hour (start, end) tuples."""
    slots = []
    h = start_time.hour
    end_h = end_time.hour
    if end_time.minute > 0:
        end_h += 1
    for hour in range(h, end_h):
        slots.append((dt_time(hour, 0), dt_time(hour + 1, 0)))
    return slots


def _find_next_position(db: Session, space_id: int, slot_date, hour_start: dt_time, exclude_order_id: int | None = None) -> int:
    """Find the next available slot position (1–6) for a given hour."""
    query = db.query(SpaceTimeSlot.slot_position).filter(
        SpaceTimeSlot.space_id == space_id,
        SpaceTimeSlot.date == slot_date,
        SpaceTimeSlot.start_time == hour_start,
        SpaceTimeSlot.status == SlotStatus.booked,
    )
    if exclude_order_id is not None:
        query = query.filter(SpaceTimeSlot.order_id != exclude_order_id)
    existing = query.all()
    taken = {s.slot_position for s in existing}
    for pos in range(1, MAX_SLOTS_PER_HOUR + 1):
        if pos not in taken:
            return pos
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Hour is full — all 6 ad slots are taken",
    )


def _expand_all_hourly_slots(selected_days):
    """Expand selected_days into a flat list of (date, hour_start, hour_end) tuples."""
    all_slots = []
    for day in selected_days:
        for tr in day.time_ranges:
            for hour_start, hour_end in _break_into_hourly_slots(tr.start_time, tr.end_time):
                all_slots.append((day.date, hour_start, hour_end))
    return all_slots


def _batch_check_capacity(db: Session, space_id: int, all_slots, exclude_order_id: int | None = None):
    """Check capacity for all slots in a single query. Returns list of conflict dicts."""
    if not all_slots:
        return []

    # Build a single query to count booked slots per (date, start_time)
    query = db.query(
        SpaceTimeSlot.date,
        SpaceTimeSlot.start_time,
        func.count(SpaceTimeSlot.id),
    ).filter(
        SpaceTimeSlot.space_id == space_id,
        SpaceTimeSlot.status == SlotStatus.booked,
    )
    if exclude_order_id is not None:
        query = query.filter(SpaceTimeSlot.order_id != exclude_order_id)

    # Only check dates that we care about
    dates_needed = list({s[0] for s in all_slots})
    query = query.filter(SpaceTimeSlot.date.in_(dates_needed))
    query = query.group_by(SpaceTimeSlot.date, SpaceTimeSlot.start_time)

    # Build lookup: (date, start_time) -> count
    counts = {}
    for row in query.all():
        counts[(row[0], row[1])] = row[2]

    conflicts = []
    for slot_date, hour_start, _ in all_slots:
        count = counts.get((slot_date, hour_start), 0)
        if count >= MAX_SLOTS_PER_HOUR:
            conflicts.append({
                "date": str(slot_date),
                "hour": hour_start.strftime("%H:%M"),
                "booked_count": count,
                "max_slots": MAX_SLOTS_PER_HOUR,
            })
    return conflicts


def _batch_find_positions(db: Session, space_id: int, all_slots, exclude_order_id: int | None = None):
    """Find slot positions for all slots using a single query. Returns dict of (date, hour_start) -> position."""
    if not all_slots:
        return {}

    dates_needed = list({s[0] for s in all_slots})

    query = db.query(
        SpaceTimeSlot.date,
        SpaceTimeSlot.start_time,
        SpaceTimeSlot.slot_position,
    ).filter(
        SpaceTimeSlot.space_id == space_id,
        SpaceTimeSlot.status == SlotStatus.booked,
        SpaceTimeSlot.date.in_(dates_needed),
    )
    if exclude_order_id is not None:
        query = query.filter(SpaceTimeSlot.order_id != exclude_order_id)

    # Build lookup: (date, start_time) -> set of taken positions
    taken: dict[tuple, set] = defaultdict(set)
    for row in query.all():
        taken[(row[0], row[1])].add(row[2])

    positions = {}
    for slot_date, hour_start, _ in all_slots:
        key = (slot_date, hour_start)
        taken_set = taken.get(key, set())
        pos = 1
        for p in range(1, MAX_SLOTS_PER_HOUR + 1):
            if p not in taken_set:
                pos = p
                break
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Hour is full — all 6 ad slots are taken",
            )
        positions[key] = pos
        taken_set.add(pos)  # Mark this position as taken for subsequent slots in same hour
    return positions


def create_order(db: Session, data: OrderCreate, user: User) -> Order:
    space = db.query(Space).options(selectinload(Space.operating_hours)).filter(Space.id == data.space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    # Validate campaign if provided
    campaign_id = None
    if data.campaign_id is not None:
        campaign = db.query(Campaign).filter(Campaign.id == data.campaign_id).first()
        if not campaign or campaign.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
        campaign_id = data.campaign_id

    selected_days = _resolve_selected_days(data)

    # Expand all hourly slots once
    all_slots = _expand_all_hourly_slots(selected_days)

    # Batch capacity check (single query instead of N queries)
    conflicts = _batch_check_capacity(db, data.space_id, all_slots)
    if conflicts:
        logger.warning("Order creation conflict user_id=%d space_id=%d conflicts=%d", user.id, data.space_id, len(conflicts))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "One or more hours are fully booked (6/6 slots taken)", "conflicts": conflicts},
        )

    total_hours = Decimal(0)
    for day in selected_days:
        for tr in day.time_ranges:
            start_h = Decimal(tr.start_time.hour) + Decimal(tr.start_time.minute) / Decimal(60)
            end_h = Decimal(tr.end_time.hour) + Decimal(tr.end_time.minute) / Decimal(60)
            total_hours += end_h - start_h
    total_cost = _compute_prorated_cost(selected_days, space)

    reference_number = f"ORD-{uuid.uuid4().hex[:8].upper()}"

    order = Order(
        reference_number=reference_number,
        user_id=user.id,
        space_id=data.space_id,
        campaign_id=campaign_id,
        booking_type=BookingType(data.booking_type),
        start_date=data.start_date,
        end_date=data.end_date,
        total_cost=total_cost,
        status=OrderStatus.pending,
        notes=data.notes,
    )
    db.add(order)
    db.flush()

    # Batch find positions (single query instead of N queries)
    positions = _batch_find_positions(db, data.space_id, all_slots)
    for slot_date, hour_start, hour_end in all_slots:
        db.add(SpaceTimeSlot(
            space_id=data.space_id,
            order_id=order.id,
            date=slot_date,
            start_time=hour_start,
            end_time=hour_end,
            slot_position=positions[(slot_date, hour_start)],
        ))

    # Persist recurring schedule rows for long_term bookings
    if data.booking_type == "long_term" and data.recurring_schedule:
        for entry in data.recurring_schedule:
            db.add(RecurringSchedule(
                order_id=order.id,
                day_of_week=entry.day_of_week,
                start_time=entry.start_time,
                end_time=entry.end_time,
            ))

    try:
        db.commit()
        db.refresh(order)
    except IntegrityError as e:
        db.rollback()
        logger.error("IntegrityError on order commit: %s", e)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more selected time slots are already booked",
        )

    create_notification(
        db, user.id, NotificationType.order_created,
        f"Your order {order.reference_number} was placed successfully", order.id,
    )
    create_order_event(
        db, order.id, ActionType.created,
        "Order was placed", user_id=user.id, actor_type=ActorType.user,
    )

    # Send emails only for standalone orders (no campaign).
    # Campaign orders are batched — email sent via /campaigns/{id}/finalize.
    if not order.campaign_id:
        try:
            send_booking_created_emails(order, user, space, db=db)
        except Exception as e:
            logger.error("Failed to queue booking emails for order %d: %s", order.id, e)

    logger.info("Order created order_id=%d ref=%s user_id=%d", order.id, order.reference_number, user.id)
    return order


def get_user_orders(db: Session, user: User, skip: int = 0, limit: int = 20) -> dict:
    # Fetch all user orders eagerly
    all_orders = (
        db.query(Order)
        .filter(Order.user_id == user.id)
        .options(
            joinedload(Order.space).selectinload(Space.images),
            selectinload(Order.time_slots),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .order_by(Order.created_at.desc())
        .all()
    )

    # Group orders by campaign_id
    campaign_map: dict[int, list] = {}  # campaign_id -> [orders]
    standalone = []
    for o in all_orders:
        if o.campaign_id is not None:
            campaign_map.setdefault(o.campaign_id, []).append(o)
        else:
            standalone.append(o)

    # Build child_map: for each campaign, oldest order is the representative, rest are children
    child_map: dict[int, list] = {}  # representative_order_id -> [child summaries]
    representative_map: dict[int, Order] = {}  # campaign_id -> representative order
    for campaign_id, orders_in_campaign in campaign_map.items():
        # Sort by created_at ascending — first created is the representative
        sorted_orders = sorted(orders_in_campaign, key=lambda o: o.created_at)
        representative = sorted_orders[0]
        children = sorted_orders[1:]
        representative_map[campaign_id] = representative
        child_map[representative.id] = [{
            "id": c.id,
            "reference_number": c.reference_number,
            "space_id": c.space_id,
            "space_name": c.space.name if c.space else None,
            "space_image": c.space.images[0].image_url if c.space and c.space.images else None,
            "booking_type": c.booking_type.value if c.booking_type else "long_term",
            "start_date": c.start_date,
            "end_date": c.end_date,
            "total_cost": c.total_cost,
            "status": c.status,
            "created_at": c.created_at,
            "notes": c.notes,
            "campaign_id": c.campaign_id,
            "time_slots": c.time_slots,
        } for c in children]

    # Top-level = standalone orders + one representative per campaign
    top_level = standalone + list(representative_map.values())
    top_level.sort(key=lambda o: o.created_at, reverse=True)
    total = len(top_level)

    # Paginate on top-level
    paginated = top_level[skip:skip + limit]

    result = []
    for o in paginated:
        result.append({
            "id": o.id,
            "reference_number": o.reference_number,
            "space_id": o.space_id,
            "booking_type": o.booking_type.value if o.booking_type else "long_term",
            "start_date": o.start_date,
            "end_date": o.end_date,
            "total_cost": o.total_cost,
            "status": o.status,
            "notes": o.notes,
            "created_at": o.created_at,
            "space_name": o.space.name if o.space else None,
            "space_image": o.space.images[0].image_url if o.space and o.space.images else None,
            "campaign_id": o.campaign_id,
            "child_orders": child_map.get(o.id, []),
            "time_slots": o.time_slots,
            "recurring_schedules": o.recurring_schedules,
            "schedule_overrides": o.schedule_overrides,
        })
    return {"items": result, "total": total}


def get_order_detail(db: Session, order_id: int, user: User) -> Order:
    order = (
        db.query(Order)
        .options(
            selectinload(Order.time_slots),
            selectinload(Order.creatives),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .filter(Order.id == order_id, Order.user_id == user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def cancel_order(db: Session, order_id: int, user: User) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status not in (OrderStatus.pending, OrderStatus.approved):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending or approved orders can be cancelled")
    order.status = OrderStatus.cancelled
    for slot in order.time_slots:
        db.delete(slot)
    db.commit()
    db.refresh(order)

    create_notification(
        db, user.id, NotificationType.order_cancelled,
        f"Your order {order.reference_number} has been cancelled", order.id,
    )
    create_order_event(
        db, order.id, ActionType.cancelled,
        "Order was cancelled by user", user_id=user.id, actor_type=ActorType.user,
    )

    logger.info("Order cancelled order_id=%d ref=%s user_id=%d", order.id, order.reference_number, user.id)
    return order


def edit_order(db: Session, order_id: int, data, user: User) -> Order:
    """Full edit of a pending order: update dates, time slots, and notes."""
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending orders can be edited")

    space = db.query(Space).options(selectinload(Space.operating_hours)).filter(Space.id == order.space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    # Determine the effective booking type
    booking_type = data.booking_type or order.booking_type.value

    # Normalize to selected_days
    if booking_type == "long_term":
        if data.recurring_schedule:
            # Build overrides from existing DB overrides
            existing_overrides = (
                db.query(ScheduleOverride)
                .filter(ScheduleOverride.order_id == order.id)
                .all()
            )
            overrides = [
                ScheduleOverrideCreate(
                    date=ov.date,
                    override_type=ov.override_type.value,
                    start_time=ov.start_time,
                    end_time=ov.end_time,
                )
                for ov in existing_overrides
            ]
            selected_days = materialize_schedule(
                data.recurring_schedule, overrides, data.start_date, data.end_date
            )
        elif data.selected_days:
            selected_days = data.selected_days
        else:
            # Re-materialize from existing recurring schedules
            existing_rs = (
                db.query(RecurringSchedule)
                .filter(RecurringSchedule.order_id == order.id)
                .all()
            )
            recurring_entries = [
                RecurringScheduleEntry(
                    day_of_week=rs.day_of_week,
                    start_time=rs.start_time,
                    end_time=rs.end_time,
                )
                for rs in existing_rs
            ]
            existing_overrides = (
                db.query(ScheduleOverride)
                .filter(ScheduleOverride.order_id == order.id)
                .all()
            )
            overrides = [
                ScheduleOverrideCreate(
                    date=ov.date,
                    override_type=ov.override_type.value,
                    start_time=ov.start_time,
                    end_time=ov.end_time,
                )
                for ov in existing_overrides
            ]
            selected_days = materialize_schedule(
                recurring_entries, overrides, data.start_date, data.end_date
            )
    else:
        if not data.selected_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="selected_days required for bookings",
            )
        selected_days = data.selected_days

    # Expand all hourly slots once
    all_slots = _expand_all_hourly_slots(selected_days)

    # Batch capacity check (single query instead of N queries)
    conflicts = _batch_check_capacity(db, order.space_id, all_slots, exclude_order_id=order.id)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "One or more hours are fully booked (6/6 slots taken)", "conflicts": conflicts},
        )

    # Delete old time slots and flush so the unique constraint is freed
    db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order.id).delete(synchronize_session="fetch")
    db.flush()

    # Update order fields
    order.start_date = data.start_date
    order.end_date = data.end_date
    order.notes = data.notes
    order.booking_type = BookingType(booking_type)

    total_hours = Decimal(0)
    for day in selected_days:
        for tr in day.time_ranges:
            start_h = Decimal(tr.start_time.hour) + Decimal(tr.start_time.minute) / Decimal(60)
            end_h = Decimal(tr.end_time.hour) + Decimal(tr.end_time.minute) / Decimal(60)
            total_hours += end_h - start_h
    order.total_cost = _compute_prorated_cost(selected_days, space)

    # Batch find positions and create new time slots
    positions = _batch_find_positions(db, order.space_id, all_slots, exclude_order_id=order.id)
    for slot_date, hour_start, hour_end in all_slots:
        db.add(SpaceTimeSlot(
            space_id=order.space_id,
            order_id=order.id,
            date=slot_date,
            start_time=hour_start,
            end_time=hour_end,
            slot_position=positions[(slot_date, hour_start)],
        ))

    # Replace recurring schedule rows if provided
    if data.recurring_schedule is not None and booking_type == "long_term":
        for rs in db.query(RecurringSchedule).filter(RecurringSchedule.order_id == order.id).all():
            db.delete(rs)
        db.flush()
        for entry in data.recurring_schedule:
            db.add(RecurringSchedule(
                order_id=order.id,
                day_of_week=entry.day_of_week,
                start_time=entry.start_time,
                end_time=entry.end_time,
            ))

    try:
        db.commit()
        db.refresh(order)
    except IntegrityError as e:
        db.rollback()
        logger.error("IntegrityError on order commit: %s", e)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more selected time slots are already booked",
        )

    create_order_event(
        db, order.id, ActionType.updated,
        "Order details were updated", user_id=user.id, actor_type=ActorType.user,
    )

    return order


def update_order_notes(db: Session, order_id: int, notes: str, user: User) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending orders can be edited")
    order.notes = notes
    db.commit()
    db.refresh(order)
    return order


def add_schedule_override(db: Session, order_id: int, user: User, override_data: ScheduleOverrideCreate) -> ScheduleOverride:
    """Add an override to a long_term order, then rebuild all slots."""
    order = (
        db.query(Order)
        .options(selectinload(Order.time_slots))
        .filter(Order.id == order_id, Order.user_id == user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending orders can be modified")
    if order.booking_type != BookingType.long_term:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Overrides only apply to long_term bookings")

    # Create the override row
    override = ScheduleOverride(
        order_id=order.id,
        date=override_data.date,
        override_type=OverrideType(override_data.override_type),
        start_time=override_data.start_time,
        end_time=override_data.end_time,
    )
    db.add(override)
    db.flush()

    # Re-materialize full schedule with all overrides
    _rebuild_slots_from_schedule(db, order)

    try:
        db.commit()
        db.refresh(override)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An override for this date already exists or slots conflict",
        )

    return override


def remove_schedule_override(db: Session, order_id: int, override_id: int, user: User) -> None:
    """Remove an override from a long_term order, then rebuild all slots."""
    order = (
        db.query(Order)
        .options(selectinload(Order.time_slots))
        .filter(Order.id == order_id, Order.user_id == user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending orders can be modified")
    if order.booking_type != BookingType.long_term:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Overrides only apply to long_term bookings")

    override = (
        db.query(ScheduleOverride)
        .filter(ScheduleOverride.id == override_id, ScheduleOverride.order_id == order.id)
        .first()
    )
    if not override:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override not found")

    db.delete(override)
    db.flush()

    _rebuild_slots_from_schedule(db, order)
    db.commit()


def _rebuild_slots_from_schedule(db: Session, order: Order) -> None:
    """Delete existing slots, re-materialize from recurring + overrides, check conflicts, create new slots."""
    space = db.query(Space).options(selectinload(Space.operating_hours)).filter(Space.id == order.space_id).first()

    # Gather recurring schedule entries
    recurring_rows = db.query(RecurringSchedule).filter(RecurringSchedule.order_id == order.id).all()
    recurring = [
        RecurringScheduleEntry(
            day_of_week=rs.day_of_week,
            start_time=rs.start_time,
            end_time=rs.end_time,
        )
        for rs in recurring_rows
    ]

    # Gather all overrides
    override_rows = db.query(ScheduleOverride).filter(ScheduleOverride.order_id == order.id).all()
    overrides = [
        ScheduleOverrideCreate(
            date=ov.date,
            override_type=ov.override_type.value,
            start_time=ov.start_time,
            end_time=ov.end_time,
        )
        for ov in override_rows
    ]

    selected_days = materialize_schedule(recurring, overrides, order.start_date, order.end_date)

    # Delete old slots
    db.query(SpaceTimeSlot).filter(SpaceTimeSlot.order_id == order.id).delete(synchronize_session="fetch")
    db.flush()

    # Expand all hourly slots and batch check capacity
    all_slots = _expand_all_hourly_slots(selected_days)
    conflicts = _batch_check_capacity(db, order.space_id, all_slots, exclude_order_id=order.id)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "One or more hours are fully booked (6/6 slots taken)", "conflicts": conflicts},
        )

    # Batch find positions and create new slots
    positions = _batch_find_positions(db, order.space_id, all_slots, exclude_order_id=order.id)
    for slot_date, hour_start, hour_end in all_slots:
        db.add(SpaceTimeSlot(
            space_id=order.space_id,
            order_id=order.id,
            date=slot_date,
            start_time=hour_start,
            end_time=hour_end,
            slot_position=positions[(slot_date, hour_start)],
        ))

    # Recalculate total cost
    total_hours = Decimal(0)
    for day in selected_days:
        for tr in day.time_ranges:
            start_h = Decimal(tr.start_time.hour) + Decimal(tr.start_time.minute) / Decimal(60)
            end_h = Decimal(tr.end_time.hour) + Decimal(tr.end_time.minute) / Decimal(60)
            total_hours += end_h - start_h
    order.total_cost = _compute_prorated_cost(selected_days, space)


def set_order_campaign(db: Session, order_id: int, campaign_id: int, user: User) -> Order:
    """Assign an existing order to a campaign."""
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id, Campaign.user_id == user.id).first()
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    order.campaign_id = campaign_id
    db.commit()
    db.refresh(order)
    return order


def duplicate_order_creatives(db: Session, target_order_id: int, source_order_id: int, user: User) -> None:
    """Copy creative records from source order to target order (shares file URLs, no physical file copy)."""
    target_order = db.query(Order).filter(Order.id == target_order_id, Order.user_id == user.id).first()
    if not target_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target order not found")

    source_order = db.query(Order).filter(Order.id == source_order_id, Order.user_id == user.id).first()
    if not source_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source order not found")

    source_creatives = db.query(OrderCreative).filter(OrderCreative.order_id == source_order_id).all()
    for c in source_creatives:
        db.add(OrderCreative(
            order_id=target_order_id,
            file_url=c.file_url,
            file_type=c.file_type,
        ))
    db.commit()
