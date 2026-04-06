from datetime import date, timedelta
from typing import List
from app.schemas.order import (
    RecurringScheduleEntry,
    ScheduleOverrideCreate,
    SelectedDay,
    TimeRange,
)


def materialize_schedule(
    recurring: List[RecurringScheduleEntry],
    overrides: List[ScheduleOverrideCreate],
    start_date: date,
    end_date: date,
) -> List[SelectedDay]:
    """
    Pure function: converts a recurring weekly schedule + per-date overrides
    into a flat list of SelectedDay objects.
    """
    # Build lookup: day_of_week -> list of TimeRange
    dow_schedule: dict[int, list[TimeRange]] = {}
    for entry in recurring:
        dow_schedule.setdefault(entry.day_of_week, []).append(
            TimeRange(start_time=entry.start_time, end_time=entry.end_time)
        )

    # Build lookup: date -> override
    override_map: dict[date, ScheduleOverrideCreate] = {}
    for ov in overrides:
        override_map[ov.date] = ov

    result: list[SelectedDay] = []
    current = start_date
    while current <= end_date:
        # Convert Python weekday (Mon=0) to our convention (Sun=0)
        dow = (current.weekday() + 1) % 7

        if current in override_map:
            ov = override_map[current]
            if ov.override_type == "skip":
                current += timedelta(days=1)
                continue
            if ov.override_type == "replace" and ov.start_time and ov.end_time:
                result.append(SelectedDay(
                    date=current,
                    time_ranges=[TimeRange(start_time=ov.start_time, end_time=ov.end_time)],
                ))
        elif dow in dow_schedule:
            result.append(SelectedDay(
                date=current,
                time_ranges=dow_schedule[dow],
            ))

        current += timedelta(days=1)

    return result
