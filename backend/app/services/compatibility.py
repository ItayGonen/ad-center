import math as _math
from collections import defaultdict
from decimal import Decimal
from datetime import time as dt_time, date as dt_date
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.order import Order, SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR
from app.models.space import Space, SpaceOperatingHours
from app.models.user import User
from app.schemas.compatibility import CompatibilitySlot, CompatibilityConflict, CompatibilityResponse, ScheduleCompatibilityRequest


def check_compatibility(db: Session, order_id: int, target_space_id: int, user: User, exclude_order_id: int | None = None) -> CompatibilityResponse:
    """Check if a source order's schedule is compatible with a target space."""
    # Load source order
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.space_id == target_space_id and exclude_order_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot duplicate to the same space",
        )

    # Load target space
    target_space = db.query(Space).filter(Space.id == target_space_id).first()
    if not target_space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target space not found")

    # Load source order's booked time slots
    source_slots = (
        db.query(SpaceTimeSlot)
        .filter(
            SpaceTimeSlot.order_id == order_id,
            SpaceTimeSlot.status == SlotStatus.booked,
        )
        .all()
    )

    if not source_slots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source order has no booked time slots",
        )

    # Load target space operating hours keyed by day_of_week
    target_oh_rows = (
        db.query(SpaceOperatingHours)
        .filter(SpaceOperatingHours.space_id == target_space_id)
        .all()
    )
    oh_by_dow = {}
    for oh in target_oh_rows:
        oh_by_dow[oh.day_of_week] = oh

    available_slots = []
    conflicts = []

    # Batch capacity check: single query for all dates
    dates_needed = list({s.date for s in source_slots})
    cap_query = db.query(
        SpaceTimeSlot.date,
        SpaceTimeSlot.start_time,
        func.count(SpaceTimeSlot.id),
    ).filter(
        SpaceTimeSlot.space_id == target_space_id,
        SpaceTimeSlot.status == SlotStatus.booked,
        SpaceTimeSlot.date.in_(dates_needed),
    )
    if exclude_order_id:
        cap_query = cap_query.filter(SpaceTimeSlot.order_id != exclude_order_id)
    cap_query = cap_query.group_by(SpaceTimeSlot.date, SpaceTimeSlot.start_time)
    booked_counts: dict[tuple, int] = {}
    for row in cap_query.all():
        booked_counts[(row[0], row[1])] = row[2]

    for slot in source_slots:
        slot_date = slot.date
        dow = (slot_date.weekday() + 1) % 7
        hour_start = slot.start_time
        hour_end = slot.end_time

        # Check operating hours
        oh = oh_by_dow.get(dow)
        if not oh:
            conflicts.append(CompatibilityConflict(
                date=str(slot_date),
                start_time=hour_start.strftime("%H:%M:%S"),
                end_time=hour_end.strftime("%H:%M:%S"),
                reason="outside_operating_hours",
            ))
            continue

        if hour_start < oh.start_time or hour_end > oh.end_time:
            conflicts.append(CompatibilityConflict(
                date=str(slot_date),
                start_time=hour_start.strftime("%H:%M:%S"),
                end_time=hour_end.strftime("%H:%M:%S"),
                reason="outside_operating_hours",
            ))
            continue

        # Check capacity using pre-fetched counts
        booked_count = booked_counts.get((slot_date, hour_start), 0)
        if booked_count >= MAX_SLOTS_PER_HOUR:
            conflicts.append(CompatibilityConflict(
                date=str(slot_date),
                start_time=hour_start.strftime("%H:%M:%S"),
                end_time=hour_end.strftime("%H:%M:%S"),
                reason="capacity_full",
            ))
        else:
            available_slots.append(CompatibilitySlot(
                date=str(slot_date),
                start_time=hour_start.strftime("%H:%M:%S"),
                end_time=hour_end.strftime("%H:%M:%S"),
            ))

    total_source = len(source_slots)
    available_count = len(available_slots)
    conflict_count = len(conflicts)

    if available_count == total_source:
        compatibility = "full"
    elif available_count > 0:
        compatibility = "partial"
    else:
        compatibility = "none"

    # Estimated cost using prorated daily rate
    # Group available hours by date, then prorate per-date
    avail_hours_by_date: dict[str, int] = {}
    for slot in available_slots:
        avail_hours_by_date[slot.date] = avail_hours_by_date.get(slot.date, 0) + 1
    estimated_cost_dec = Decimal(0)
    for date_str, hour_count in avail_hours_by_date.items():
        d = dt_date.fromisoformat(date_str)
        dow = (d.weekday() + 1) % 7
        oh = oh_by_dow.get(dow)
        if oh:
            daily_op = Decimal(_math.floor(oh.end_time.hour + oh.end_time.minute / 60) - _math.ceil(oh.start_time.hour + oh.start_time.minute / 60))
        else:
            daily_op = Decimal(hour_count)
        if daily_op <= 0:
            daily_op = Decimal(1)
        estimated_cost_dec += (target_space.price_per_day / daily_op) * Decimal(hour_count)
    estimated_cost = float(estimated_cost_dec)

    return CompatibilityResponse(
        compatibility=compatibility,
        target_space_id=target_space_id,
        target_space_name=target_space.name or "",
        target_space_price_per_day=float(target_space.price_per_day),
        available_slots=available_slots,
        conflicts=conflicts,
        available_count=available_count,
        conflict_count=conflict_count,
        total_source_slots=total_source,
        estimated_cost=estimated_cost,
    )


def check_schedule_compatibility(db: Session, request: ScheduleCompatibilityRequest, user: User) -> CompatibilityResponse:
    """Check if a schedule (given as slots) is compatible with a target space, without requiring an existing order."""
    target_space_id = request.target_space_id

    if not request.slots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No schedule slots provided",
        )

    # Load target space
    target_space = db.query(Space).filter(Space.id == target_space_id).first()
    if not target_space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target space not found")

    # Load target space operating hours keyed by day_of_week
    target_oh_rows = (
        db.query(SpaceOperatingHours)
        .filter(SpaceOperatingHours.space_id == target_space_id)
        .all()
    )
    oh_by_dow = {}
    for oh in target_oh_rows:
        oh_by_dow[oh.day_of_week] = oh

    available_slots = []
    conflicts = []

    # Batch capacity check: single query for all dates
    dates_needed = list({dt_date.fromisoformat(s.date) for s in request.slots})
    cap_query = db.query(
        SpaceTimeSlot.date,
        SpaceTimeSlot.start_time,
        func.count(SpaceTimeSlot.id),
    ).filter(
        SpaceTimeSlot.space_id == target_space_id,
        SpaceTimeSlot.status == SlotStatus.booked,
        SpaceTimeSlot.date.in_(dates_needed),
    ).group_by(SpaceTimeSlot.date, SpaceTimeSlot.start_time)
    booked_counts: dict[tuple, int] = {}
    for row in cap_query.all():
        booked_counts[(row[0], row[1])] = row[2]

    for slot in request.slots:
        slot_date = dt_date.fromisoformat(slot.date)
        dow = (slot_date.weekday() + 1) % 7
        hour_start = dt_time.fromisoformat(slot.start_time)
        hour_end = dt_time.fromisoformat(slot.end_time)

        # Check operating hours
        oh = oh_by_dow.get(dow)
        if not oh:
            conflicts.append(CompatibilityConflict(
                date=slot.date,
                start_time=slot.start_time,
                end_time=slot.end_time,
                reason="outside_operating_hours",
            ))
            continue

        if hour_start < oh.start_time or hour_end > oh.end_time:
            conflicts.append(CompatibilityConflict(
                date=slot.date,
                start_time=slot.start_time,
                end_time=slot.end_time,
                reason="outside_operating_hours",
            ))
            continue

        # Check capacity using pre-fetched counts
        booked_count = booked_counts.get((slot_date, hour_start), 0)
        if booked_count >= MAX_SLOTS_PER_HOUR:
            conflicts.append(CompatibilityConflict(
                date=slot.date,
                start_time=slot.start_time,
                end_time=slot.end_time,
                reason="capacity_full",
            ))
        else:
            available_slots.append(CompatibilitySlot(
                date=slot.date,
                start_time=slot.start_time,
                end_time=slot.end_time,
            ))

    total_source = len(request.slots)
    available_count = len(available_slots)
    conflict_count = len(conflicts)

    if available_count == total_source:
        compatibility = "full"
    elif available_count > 0:
        compatibility = "partial"
    else:
        compatibility = "none"

    # Estimated cost using prorated daily rate
    avail_hours_by_date: dict[str, int] = {}
    for s in available_slots:
        avail_hours_by_date[s.date] = avail_hours_by_date.get(s.date, 0) + 1
    estimated_cost_dec = Decimal(0)
    for date_str, hour_count in avail_hours_by_date.items():
        d = dt_date.fromisoformat(date_str)
        dow = (d.weekday() + 1) % 7
        oh = oh_by_dow.get(dow)
        if oh:
            daily_op = Decimal(_math.floor(oh.end_time.hour + oh.end_time.minute / 60) - _math.ceil(oh.start_time.hour + oh.start_time.minute / 60))
        else:
            daily_op = Decimal(hour_count)
        if daily_op <= 0:
            daily_op = Decimal(1)
        estimated_cost_dec += (target_space.price_per_day / daily_op) * Decimal(hour_count)
    estimated_cost = float(estimated_cost_dec)

    return CompatibilityResponse(
        compatibility=compatibility,
        target_space_id=target_space_id,
        target_space_name=target_space.name or "",
        target_space_price_per_day=float(target_space.price_per_day),
        available_slots=available_slots,
        conflicts=conflicts,
        available_count=available_count,
        conflict_count=conflict_count,
        total_source_slots=total_source,
        estimated_cost=estimated_cost,
    )
