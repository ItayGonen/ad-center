from datetime import date, time, timedelta
from collections import defaultdict
from sqlalchemy.orm import Session, selectinload
from fastapi import HTTPException, status
from app.models.space import Space, SpaceOperatingHours, AudienceProfile, SpaceType, Screen
from app.models.user import User
from app.models.order import SpaceTimeSlot, SlotStatus, MAX_SLOTS_PER_HOUR
from app.schemas.space import DayAvailability, TimeWindow, HourSlotInfo
from app.schemas.order import (
    CalendarSlotOrder, CalendarHourSlot, CalendarDayEntry,
    CalendarSpaceSummary, AdminCalendarResponse,
)


def get_all_spaces(db: Session, skip: int = 0, limit: int = 20, audience_profile_ids: list[int] | None = None) -> dict:
    base_query = db.query(Space)
    if audience_profile_ids:
        base_query = base_query.filter(Space.audience_profiles.any(AudienceProfile.id.in_(audience_profile_ids)))
    total = base_query.count()
    spaces = (
        base_query
        .options(selectinload(Space.images), selectinload(Space.audience_profiles))
        .offset(skip)
        .limit(limit)
        .all()
    )
    # Batch-load partner names
    partner_ids = {s.partner_owner for s in spaces if s.partner_owner}
    partner_map = {}
    if partner_ids:
        partners = db.query(User.id, User.name).filter(User.id.in_(partner_ids)).all()
        partner_map = {p.id: p.name for p in partners}

    result = []
    for space in spaces:
        first_image = space.images[0].image_url if space.images else None
        result.append({
            "id": space.id,
            "name": space.name,
            "city": space.city,
            "space_type": {"id": space.space_type.id, "name": space.space_type.name} if space.space_type else None,
            "environment": space.environment,
            "estimated_daily_impressions": space.estimated_daily_impressions,
            "price_per_day": space.price_per_day,
            "first_image": first_image,
            "partner_owner": space.partner_owner,
            "partner_name": partner_map.get(space.partner_owner) if space.partner_owner else None,
            "audience_profiles": [{"id": ap.id, "name": ap.name, "category": ap.category.value} for ap in space.audience_profiles],
        })
    return {"items": result, "total": total}


def get_all_audience_profiles(db: Session) -> list:
    return db.query(AudienceProfile).order_by(AudienceProfile.category, AudienceProfile.name).all()


def get_all_space_types(db: Session) -> list:
    return db.query(SpaceType).order_by(SpaceType.name).all()


def get_space_detail(db: Session, space_id: int) -> dict:
    space = (
        db.query(Space)
        .options(selectinload(Space.images), selectinload(Space.operating_hours), selectinload(Space.audience_profiles), selectinload(Space.screens))
        .filter(Space.id == space_id)
        .first()
    )
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    partner_name = None
    partner_profile_picture = None
    if space.partner_owner:
        partner = db.query(User.name, User.profile_picture).filter(User.id == space.partner_owner).first()
        if partner:
            partner_name = partner.name
            partner_profile_picture = partner.profile_picture

    # Attach partner fields as attributes for Pydantic serialization
    space.partner_name = partner_name
    space.partner_profile_picture = partner_profile_picture
    return space


def get_availability(db: Session, space_id: int, start_date: date, end_date: date, exclude_order_id: int | None = None) -> list[DayAvailability]:
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    operating_hours = db.query(SpaceOperatingHours).filter(
        SpaceOperatingHours.space_id == space_id
    ).all()
    hours_by_day = {oh.day_of_week: oh for oh in operating_hours}

    booked_query = db.query(SpaceTimeSlot).filter(
        SpaceTimeSlot.space_id == space_id,
        SpaceTimeSlot.date >= start_date,
        SpaceTimeSlot.date <= end_date,
        SpaceTimeSlot.status == SlotStatus.booked,
    )
    if exclude_order_id is not None:
        booked_query = booked_query.filter(SpaceTimeSlot.order_id != exclude_order_id)
    booked_slots = booked_query.all()

    # Group booked slots by (date, start_time) to count per-hour bookings
    booked_by_date: dict[date, dict[time, int]] = {}
    for slot in booked_slots:
        if slot.date not in booked_by_date:
            booked_by_date[slot.date] = defaultdict(int)
        booked_by_date[slot.date][slot.start_time] += 1

    result = []
    current = start_date
    while current <= end_date:
        dow = (current.weekday() + 1) % 7  # 0=Sunday, 6=Saturday
        oh = hours_by_day.get(dow)

        # Skip days that have no operating hours defined
        if not oh:
            current += timedelta(days=1)
            continue

        op_start = oh.start_time
        op_end = oh.end_time
        day_counts = booked_by_date.get(current, {})

        # Build per-hour slot info and available windows
        hour_slots: list[HourSlotInfo] = []
        available_hours: list[int] = []  # hours where booked_count < MAX

        start_h = op_start.hour
        end_h = op_end.hour
        for h in range(start_h, end_h):
            h_time = time(h, 0)
            booked_count = day_counts.get(h_time, 0)
            hour_slots.append(HourSlotInfo(
                hour=f"{h:02d}:00",
                booked_count=booked_count,
                max_slots=MAX_SLOTS_PER_HOUR,
            ))
            if booked_count < MAX_SLOTS_PER_HOUR:
                available_hours.append(h)

        # Build available_windows from consecutive available hours
        available: list[TimeWindow] = []
        if available_hours:
            win_start = available_hours[0]
            prev = available_hours[0]
            for h in available_hours[1:]:
                if h == prev + 1:
                    prev = h
                else:
                    available.append(TimeWindow(
                        start_time=time(win_start, 0),
                        end_time=time(prev + 1, 0),
                    ))
                    win_start = h
                    prev = h
            available.append(TimeWindow(
                start_time=time(win_start, 0),
                end_time=time(prev + 1, 0),
            ))

        result.append(DayAvailability(
            date=current,
            day_of_week=dow,
            available_windows=available,
            operating_hours=TimeWindow(start_time=op_start, end_time=op_end),
            hour_slots=hour_slots,
        ))
        current += timedelta(days=1)

    return result


def get_admin_calendar(db: Session, start_date: date, end_date: date) -> AdminCalendarResponse:
    from app.models.order import Order

    # Fetch all spaces with operating hours
    spaces = db.query(Space).options(selectinload(Space.operating_hours)).all()
    if not spaces:
        return AdminCalendarResponse(days=[], spaces=[])

    space_map = {s.id: s for s in spaces}

    # Build operating hours lookup: {space_id: {day_of_week: SpaceOperatingHours}}
    oh_by_space: dict[int, dict[int, SpaceOperatingHours]] = {}
    for space in spaces:
        oh_by_space[space.id] = {oh.day_of_week: oh for oh in space.operating_hours}

    # Fetch all booked slots in the date range, eager-load order→user and order→space
    booked_slots = (
        db.query(SpaceTimeSlot)
        .filter(
            SpaceTimeSlot.date >= start_date,
            SpaceTimeSlot.date <= end_date,
            SpaceTimeSlot.status == SlotStatus.booked,
        )
        .options(
            selectinload(SpaceTimeSlot.order).selectinload(Order.user),
            selectinload(SpaceTimeSlot.order).selectinload(Order.space),
        )
        .all()
    )

    # Group slots by (date, hour, space_id)
    # Key: (date, hour_int, space_id) → list of SpaceTimeSlot
    slots_grouped: dict[tuple, list] = defaultdict(list)
    for slot in booked_slots:
        key = (slot.date, slot.start_time.hour, slot.space_id)
        slots_grouped[key].append(slot)

    # Build response
    days = []
    current = start_date
    while current <= end_date:
        dow = (current.weekday() + 1) % 7  # 0=Sunday, 6=Saturday

        hour_slots_for_day: list[CalendarHourSlot] = []
        for space in spaces:
            oh = oh_by_space.get(space.id, {}).get(dow)
            if not oh:
                continue

            start_h = oh.start_time.hour
            end_h = oh.end_time.hour
            for h in range(start_h, end_h):
                key = (current, h, space.id)
                slot_list = slots_grouped.get(key, [])

                orders = []
                for slot in slot_list:
                    order = slot.order
                    if order:
                        orders.append(CalendarSlotOrder(
                            order_id=order.id,
                            reference_number=order.reference_number,
                            user_id=order.user_id,
                            user_name=order.user.name if order.user else "Unknown",
                            user_email=order.user.email if order.user else "Unknown",
                            space_id=order.space_id,
                            space_name=order.space.name if order.space else f"#{order.space_id}",
                            booking_type=order.booking_type.value if order.booking_type else "long_term",
                            campaign_id=order.campaign_id,
                            status=order.status.value if order.status else "pending",
                            total_cost=float(order.total_cost),
                            slot_position=slot.slot_position,
                        ))

                hour_slots_for_day.append(CalendarHourSlot(
                    space_id=space.id,
                    space_name=space.name,
                    hour=f"{h:02d}:00",
                    booked_count=len(slot_list),
                    max_slots=MAX_SLOTS_PER_HOUR,
                    orders=orders,
                ))

        days.append(CalendarDayEntry(
            date=current,
            day_of_week=dow,
            hours=hour_slots_for_day,
        ))
        current += timedelta(days=1)

    space_summaries = [CalendarSpaceSummary(id=s.id, name=s.name) for s in spaces]
    return AdminCalendarResponse(days=days, spaces=space_summaries)
