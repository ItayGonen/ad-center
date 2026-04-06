import { Fragment, useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdminCalendar } from '../services/admin';
import type { AdminCalendarResponse, CalendarHourSlot, CalendarSlotOrder } from '../services/admin';
import Loader from '../components/Loader';

function getWeekStart(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0=Sunday
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AdminCalendar() {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<AdminCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [filterSpaceId, setFilterSpaceId] = useState<number | 'all'>('all');
  const [filterBookingType, setFilterBookingType] = useState<'all' | 'spotlight' | 'long_term'>('all');
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; hour: string; hours: CalendarHourSlot[] } | null>(null);

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return end;
  }, [weekStart]);

  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [weekStart]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAdminCalendar(formatDate(weekStart), formatDate(weekEnd));
      setData(result);
    } catch {
      setError(t('failedLoadCalendar'));
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd, t]);

  useEffect(() => { loadData(); }, [loadData]);

  function prevWeek() {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }

  function nextWeek() {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }

  function goToday() {
    setWeekStart(getWeekStart(new Date()));
  }

  // Build day map for quick lookup
  const dayMap = useMemo(() => {
    if (!data) return new Map<string, CalendarHourSlot[]>();
    const m = new Map<string, CalendarHourSlot[]>();
    for (const day of data.days) {
      m.set(day.date, day.hours);
    }
    return m;
  }, [data]);

  // Filter hour slots
  const getFilteredHours = useCallback((dateStr: string): CalendarHourSlot[] => {
    const hours = dayMap.get(dateStr) || [];
    return hours.filter(h => {
      if (filterSpaceId !== 'all' && h.space_id !== filterSpaceId) return false;
      if (filterBookingType !== 'all') {
        // Filter based on whether any order matches the type
        const hasMatchingOrders = h.orders.some(o => o.booking_type === filterBookingType);
        const hasBookings = h.orders.length > 0;
        if (hasBookings && !hasMatchingOrders) return false;
      }
      return true;
    });
  }, [dayMap, filterSpaceId, filterBookingType]);

  // Compute hour range across all filtered data for the week
  const { minHour, maxHour } = useMemo(() => {
    let min = 24;
    let max = 0;
    for (const dateObj of weekDates) {
      const dateStr = formatDate(dateObj);
      const hours = getFilteredHours(dateStr);
      for (const h of hours) {
        const hNum = parseInt(h.hour.split(':')[0], 10);
        if (hNum < min) min = hNum;
        if (hNum + 1 > max) max = hNum + 1;
      }
    }
    if (min >= max) { min = 8; max = 20; }
    return { minHour: min, maxHour: max };
  }, [weekDates, getFilteredHours]);

  const hourLabels = useMemo(() => {
    const labels: string[] = [];
    for (let h = minHour; h < maxHour; h++) {
      labels.push(`${String(h).padStart(2, '0')}:00`);
    }
    return labels;
  }, [minHour, maxHour]);

  // Aggregate cell data for a given date+hour
  function getCellData(dateStr: string, hour: string) {
    const hours = getFilteredHours(dateStr);
    const matching = hours.filter(h => h.hour === hour);
    const totalBooked = matching.reduce((sum, h) => sum + h.booked_count, 0);
    const totalCapacity = matching.reduce((sum, h) => sum + h.max_slots, 0);
    return { totalBooked, totalCapacity, matching };
  }

  function getCellClass(totalBooked: number, totalCapacity: number): string {
    if (totalCapacity === 0) return 'ac-cell-empty';
    const pct = (totalBooked / totalCapacity) * 100;
    if (pct === 0) return 'ac-cell-empty';
    if (pct >= 100) return 'ac-cell-full';
    return 'ac-cell-partial';
  }

  function getBarWidth(totalBooked: number, totalCapacity: number): number {
    if (totalCapacity === 0) return 0;
    return Math.min(100, (totalBooked / totalCapacity) * 100);
  }

  const todayStr = formatDate(new Date());

  function handleCellClick(dateStr: string, hour: string, matching: CalendarHourSlot[]) {
    setSelectedSlot({ date: dateStr, hour, hours: matching });
  }

  if (loading && !data) return <Loader variant="page" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab active">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab">{t('settings')}</Link>
      </div>

      <div className="admin-header">
        <h1>{t('manageCalendar')}</h1>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="ac-toolbar">
        <div className="ac-filters">
          <select
            value={filterSpaceId}
            onChange={e => setFilterSpaceId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="ac-filter-select"
          >
            <option value="all">{t('allSpaces')}</option>
            {data?.spaces.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <select
            value={filterBookingType}
            onChange={e => setFilterBookingType(e.target.value as 'all' | 'spotlight' | 'long_term')}
            className="ac-filter-select"
          >
            <option value="all">{t('allTypes')}</option>
            <option value="spotlight">{t('spotlight')}</option>
            <option value="long_term">{t('longTerm')}</option>
          </select>
        </div>

        <div className="ac-week-nav">
          <button className="ac-nav-btn" onClick={prevWeek} title={t('prevWeek')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="ac-week-label">
            {formatShortDate(weekStart)} &ndash; {formatShortDate(weekEnd)}
          </span>
          <button className="ac-nav-btn" onClick={nextWeek} title={t('nextWeek')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button className="ac-today-btn" onClick={goToday}>{t('today')}</button>
        </div>
      </div>

      {loading && <div className="ac-loading-bar" />}

      {data && data.spaces.length === 0 ? (
        <div className="ac-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>{t('noSpacesYet')}</p>
        </div>
      ) : (
        <div className="ac-grid" style={{ gridTemplateColumns: `64px repeat(7, 1fr)` }}>
          {/* Header row */}
          <div className="ac-corner" />
          {weekDates.map((d, i) => {
            const isToday = formatDate(d) === todayStr;
            return (
              <div key={i} className={`ac-header-cell${isToday ? ' ac-today' : ''}`}>
                <span className="ac-day-name">{DAY_NAMES[i]}</span>
                <span className="ac-day-date">{d.getDate()}</span>
              </div>
            );
          })}

          {/* Hour rows */}
          {hourLabels.map(hour => (
            <Fragment key={hour}>
              <div className="ac-time-label">{hour}</div>
              {weekDates.map((d, colIdx) => {
                const dateStr = formatDate(d);
                const { totalBooked, totalCapacity, matching } = getCellData(dateStr, hour);
                const cellClass = getCellClass(totalBooked, totalCapacity);
                const barWidth = getBarWidth(totalBooked, totalCapacity);
                const isToday = dateStr === todayStr;

                return (
                  <div
                    key={`${hour}-${colIdx}`}
                    className={`ac-cell ${cellClass}${isToday ? ' ac-today-col' : ''}`}
                    onClick={() => handleCellClick(dateStr, hour, matching)}
                  >
                    {totalCapacity > 0 && (
                      <>
                        <span className="ac-cell-count">{totalBooked}/{totalCapacity}</span>
                        <div className="ac-cell-bar">
                          <div
                            className={`ac-cell-bar-fill ${cellClass}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {selectedSlot && (
        <div className="ac-drawer-overlay" onClick={() => setSelectedSlot(null)}>
          <div className="ac-drawer" onClick={e => e.stopPropagation()}>
            <div className="ac-drawer-header">
              <div>
                <h3 className="ac-drawer-title">{selectedSlot.date} &middot; {selectedSlot.hour}</h3>
                <p className="ac-drawer-subtitle">
                  {t('bookingsCount', { count: selectedSlot.hours.reduce((s, h) => s + h.booked_count, 0) })}
                </p>
              </div>
              <button className="ac-drawer-close" onClick={() => setSelectedSlot(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="ac-drawer-body">
              {selectedSlot.hours.length === 0 || selectedSlot.hours.every(h => h.orders.length === 0) ? (
                <div className="ac-drawer-empty">{t('noBookingsThisSlot')}</div>
              ) : (
                selectedSlot.hours
                  .filter(h => h.orders.length > 0)
                  .map(h => (
                    <div key={h.space_id} className="ac-drawer-space">
                      <div className="ac-drawer-space-header">
                        <span className="ac-drawer-space-name">{h.space_name}</span>
                        <span className="ac-drawer-space-count">
                          {t('slotCapacity', { booked: h.booked_count, max: h.max_slots })}
                        </span>
                      </div>
                      <div className="ac-order-list">
                        {h.orders.map((order: CalendarSlotOrder) => (
                          <div key={`${order.order_id}-${order.slot_position}`} className="ac-order-card">
                            <div className="ac-order-card-top">
                              <span className="ac-order-ref">{order.reference_number}</span>
                              <span className={`ac-order-status status-${order.status}`}>{order.status}</span>
                            </div>
                            <div className="ac-order-card-body">
                              <span className="ac-order-user">{order.user_name}</span>
                              <span className="ac-order-type">
                                {order.campaign_id ? `Campaign #${order.campaign_id}` : order.booking_type === 'spotlight' ? 'Spotlight' : 'Single'}
                              </span>
                              <span className="ac-order-cost">&#8362;{order.total_cost.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
