import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMyOrders, cancelOrder, getCreatives, getOrderTimeline, cancelCampaign, getCampaignDetail } from '../services/orders';
import type { OrderListItem, ChildOrderItem, Creative, OrderEvent, ScheduleSlot } from '../services/orders';
import DuplicateOrderModal from '../components/DuplicateOrderModal';
import AddAdvancedSpaceModal from '../components/AddAdvancedSpaceModal';
import AppModal from '../components/AppModal';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';
import VideoThumbnail from '../components/VideoThumbnail';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* Lucide icon-only status system */
const STATUS_ICONS: Record<string, JSX.Element> = {
  /* Clock — amber-500 */
  pending: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  /* CheckCircle2 — blue-500 */
  approved: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
  ),
  /* ShieldCheck — indigo-500 */
  confirmed: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
  ),
  /* XCircle — red-600 */
  cancelled: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
  ),
  /* CheckCircle — gray-500 */
  completed: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  ),
  /* PlayCircle — emerald-500 (for active phase, mapped from confirmed/approved status) */
  active: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
  ),
};

const STATUS_KEYS: Record<string, { key: string }> = {
  pending:   { key: 'pending' },
  approved:  { key: 'approved' },
  confirmed: { key: 'confirmed' },
  cancelled: { key: 'cancelled' },
  completed: { key: 'completed' },
};

/* Pick icon key: use "active" PlayCircle when order is in the active phase */
function getStatusIconKey(status: string, phase?: OrderPhase): string {
  if (phase === 'active') return 'active';
  return status;
}

const EVENT_KEYS: Record<string, { icon: string; color: string; key: string }> = {
  created:   { icon: '+',  color: '#10b981', key: 'orderCreated' },
  approved:  { icon: '\u2713', color: '#475569', key: 'orderApproved' },
  confirmed: { icon: '\u2713', color: '#2563eb', key: 'orderConfirmed' },
  cancelled: { icon: '\u2717', color: '#ef4444', key: 'orderCancelled' },
  completed: { icon: '\u2605', color: '#6b7280', key: 'orderCompleted' },
  updated:   { icon: '\u270E', color: '#f59e0b', key: 'orderUpdated' },
};

type OrderPhase = 'completed' | 'active' | 'approved' | 'upcoming' | 'cancelled';

const TAB_ORDER: OrderPhase[] = ['completed', 'active', 'approved', 'upcoming', 'cancelled'];
const ORDERS_PER_PAGE = 10;

/* ─── Helper: get exact start datetime from order's time_slots ─── */
function getOrderStartDateTime(order: { start_date: string; time_slots?: { date: string; start_time: string }[] }): Date {
  const slots = order.time_slots || [];
  const matchingSlots = slots.filter(s => s.date === order.start_date);
  if (matchingSlots.length > 0) {
    const earliest = matchingSlots.reduce((min, s) => s.start_time < min ? s.start_time : min, matchingSlots[0].start_time);
    return new Date(`${order.start_date}T${earliest}`);
  }
  // Fallback: midnight of start_date
  const d = new Date(order.start_date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ─── Helper: get exact end datetime from order's time_slots ─── */
function getOrderEndDateTime(order: { end_date: string; time_slots?: { date: string; end_time: string }[] }): Date {
  const slots = order.time_slots || [];
  const matchingSlots = slots.filter(s => s.date === order.end_date);
  if (matchingSlots.length > 0) {
    const latest = matchingSlots.reduce((max, s) => s.end_time > max ? s.end_time : max, matchingSlots[0].end_time);
    return new Date(`${order.end_date}T${latest}`);
  }
  // Fallback: end of day
  const d = new Date(order.end_date);
  d.setHours(23, 59, 59, 0);
  return d;
}

/*
  Phase logic:
  - completed  → status=completed, OR any confirmed/approved order past end datetime
  - active     → confirmed/approved order whose start datetime has arrived (now >= start && now <= end)
  - approved   → confirmed/approved order not yet started (now < start)  — "Confirmed by user, waiting to start"
  - upcoming   → pending order (not yet confirmed by user)
  - cancelled  → status=cancelled
*/
function getOrderPhase(order: { start_date: string; end_date: string; status: string; time_slots?: { date: string; start_time: string; end_time: string }[] }): OrderPhase {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'completed') return 'completed';
  const now = new Date();
  const startDT = getOrderStartDateTime(order);
  const endDT = getOrderEndDateTime(order);

  // Confirmed or approved by admin → "user-confirmed" statuses
  if (order.status === 'confirmed' || order.status === 'approved') {
    if (now > endDT) return 'completed';
    if (now >= startDT) return 'active';
    return 'approved'; // confirmed but not yet started
  }

  // Pending → "upcoming" (not yet confirmed by user)
  // If past end datetime, still show as completed
  if (now > endDT) return 'completed';
  return 'upcoming';
}

function getCountdown(order: { start_date: string; time_slots?: { date: string; start_time: string }[] }): { days: number; hours: number; minutes: number } {
  const now = new Date();
  const startDT = getOrderStartDateTime(order);
  const diffMs = startDT.getTime() - now.getTime();
  if (diffMs <= 0) return { days: 0, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, minutes: totalMinutes % 60 };
}

function getProgressInfo(order: { start_date: string; end_date: string; time_slots?: { date: string }[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slots = order.time_slots || [];
  const uniqueDates = [...new Set(slots.map(s => s.date))].sort();
  const totalDates = uniqueDates.length;
  const completedDates = uniqueDates.filter(d => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date < today;
  }).length;
  const remainingDates = totalDates - completedDates;

  const start = new Date(order.start_date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(order.end_date);
  end.setHours(0, 0, 0, 0);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const elapsedDays = Math.max(0, Math.ceil((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const percent = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

  const remainingMs = end.getTime() - today.getTime();
  const remainingCalendarDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));

  return { totalDates, completedDates, remainingDates, percent, remainingCalendarDays };
}

/* ─── Helper: estimate impressions from time_slots ─── */
function estimateImpressions(order: { time_slots?: { date: string }[] }): number {
  return (order.time_slots?.length || 0) * 100;
}

/* ─── Helper: live status for active orders ─── */
function getLiveStatus(order: { time_slots?: { date: string; start_time: string; end_time: string }[] }): 'live' | 'scheduled_today' | 'off_air' {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const slots = order.time_slots || [];
  const todaySlots = slots.filter(s => s.date === todayStr);
  if (todaySlots.length === 0) return 'off_air';
  const nowTime = now.toTimeString().slice(0, 8); // HH:MM:SS
  const isLive = todaySlots.some(s => nowTime >= s.start_time && nowTime <= s.end_time);
  return isLive ? 'live' : 'scheduled_today';
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}


/* ─── Helper: build schedule summary from time_slots ─── */
function mergeTimeRanges(ranges: { start: string; end: string }[]): string[] {
  if (ranges.length === 0) return [];
  // Sort by start time
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const merged: { start: string; end: string }[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    // If current start equals or is before last end, merge (continuous or overlapping)
    if (sorted[i].start <= last.end) {
      if (sorted[i].end > last.end) last.end = sorted[i].end;
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged.map(r => `${r.start.slice(0, 5)}\u2013${r.end.slice(0, 5)}`);
}

function buildSchedule(slots: { date: string; start_time: string; end_time: string }[]) {
  const byDow = new Map<number, { dates: Set<string>; ranges: { start: string; end: string }[] }>();
  for (const slot of slots) {
    const dow = new Date(slot.date).getDay();
    if (!byDow.has(dow)) byDow.set(dow, { dates: new Set(), ranges: [] });
    const entry = byDow.get(dow)!;
    entry.dates.add(slot.date);
    entry.ranges.push({ start: slot.start_time, end: slot.end_time });
  }
  // Convert to merged time strings
  const result = new Map<number, { dates: Set<string>; times: string[] }>();
  for (const [dow, entry] of byDow) {
    // Deduplicate ranges before merging
    const uniqueRanges = new Map<string, { start: string; end: string }>();
    for (const r of entry.ranges) {
      const key = `${r.start}-${r.end}`;
      if (!uniqueRanges.has(key)) uniqueRanges.set(key, r);
    }
    result.set(dow, { dates: entry.dates, times: mergeTimeRanges([...uniqueRanges.values()]) });
  }
  return result;
}

/** Group schedule by identical time ranges → condensed day-range labels */
function groupScheduleByHours(byDow: Map<number, { dates: Set<string>; times: string[] }>) {
  // Collect active DOWs sorted
  const activeDows = [...byDow.keys()].sort((a, b) => a - b);
  if (activeDows.length === 0) return [];

  // Group by times key
  const groups: { dows: number[]; timesKey: string; times: string }[] = [];
  for (const dow of activeDows) {
    const entry = byDow.get(dow)!;
    const timesKey = entry.times.join(' | ');
    const last = groups[groups.length - 1];
    // Merge into previous group if same times and consecutive DOW
    if (last && last.timesKey === timesKey && dow === last.dows[last.dows.length - 1] + 1) {
      last.dows.push(dow);
    } else {
      groups.push({ dows: [dow], timesKey, times: entry.times.join(' , ') });
    }
  }

  return groups.map(g => {
    const dayLabel = g.dows.length === 1
      ? DAY_NAMES[g.dows[0]]
      : `${DAY_NAMES[g.dows[0]]} – ${DAY_NAMES[g.dows[g.dows.length - 1]]}`;
    return { dayLabel, times: g.times };
  });
}


/* ─── Three-dot menu for mobile ─── */
function ThreeDotMenu({ actions }: { actions: { label: string; icon: JSX.Element; onClick: () => void; variant?: 'danger' }[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen(prev => !prev);
  };

  if (actions.length === 0) return null;

  return (
    <div className="mo2-dot-menu">
      <button type="button" ref={triggerRef} className="mo2-dot-trigger" onClick={handleToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
      {open && pos && (
        <div className="mo2-dot-dropdown" ref={dropdownRef} style={{ top: pos.top, right: pos.right }}>
          {actions.map((a, i) => (
            <button key={i} type="button" className={`mo2-dot-option${a.variant === 'danger' ? ' mo2-dot-option-danger' : ''}`} onClick={e => { e.stopPropagation(); a.onClick(); setOpen(false); }}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Reusable FilterDropdown (same pattern as Locations) ─── */
function FilterDropdown<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div className={`fd-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="fd-trigger" onClick={() => setOpen(prev => !prev)}>
        <span className="fd-trigger-label">{selected?.label ?? ''}</span>
        <svg className="fd-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="fd-menu">
        {options.map(opt => (
          <button
            key={String(opt.value)}
            type="button"
            className={`fd-option${opt.value === value ? ' active' : ''}`}
            onClick={() => { onChange(opt.value); setOpen(false); }}
          >
            {opt.label}
            {opt.value === value && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────
   Order card with space image + expandable detail
   ─────────────────────────────────────────────────── */
function OrderCard({
  order,
  creativesMap,
  isExpanded,
  onToggleExpand,
  onEdit,
  onCancel,
  onDuplicate,
  hideDuplicate,
  isChild,
  timelineOrderId,
  timelineEvents,
  timelineLoading,
  onToggleTimeline,
  tag: _tag,
  phase,
  hideRow,
  hideStatusIcon,
}: {
  order: OrderListItem;
  creativesMap: Record<number, Creative[]>;
  isExpanded: boolean;
  onToggleExpand: (id: number) => void;
  onEdit: (order: OrderListItem) => void;
  onCancel: (id: number) => void;
  onDuplicate?: (order: OrderListItem) => void;
  hideDuplicate?: boolean;
  isChild?: boolean;
  timelineOrderId: number | null;
  timelineEvents: OrderEvent[];
  timelineLoading: boolean;
  onToggleTimeline: (id: number) => void;
  tag?: string;
  phase?: OrderPhase;
  hideRow?: boolean;
  hideStatusIcon?: boolean;
}) {
  const { t } = useTranslation('orders');
  const orderPhase = phase || getOrderPhase(order);
  const statusCfg = STATUS_KEYS[order.status] || STATUS_KEYS.completed;
  const isUpcoming = orderPhase === 'upcoming';
  const isApproved = orderPhase === 'approved';
  const isActive = orderPhase === 'active';
  const isPending = order.status === 'pending';
  const canEdit = isUpcoming && isPending;
  const byDow = order.time_slots ? buildSchedule(order.time_slots) : new Map();
  const totalHours = order.time_slots?.length || 0;
  const imgUrl = order.space_image ? `${API_URL}${order.space_image}` : null;
  const progress = isActive ? getProgressInfo(order) : null;
  // Countdown for approved (confirmed, not yet started) orders
  const showCountdown = isApproved;
  const countdown = showCountdown ? getCountdown(order) : null;

  return (
    <div className={`mo2-card${isExpanded ? ' mo2-card-expanded' : ''}${isChild ? ' mo2-card-child' : ''}${order.status === 'cancelled' ? ' mo2-card-cancelled' : ''}`}>
      {/* ── Collapsed row (hidden when hideRow is true) ── */}
      {!hideRow && (
        <div className="mo2-card-row" onClick={() => onToggleExpand(order.id)}>
          {/* Left: info stack */}
          <div className="mo2-header-left">
            <div className="mo2-header-top">
              {!hideStatusIcon && <span className={`mo2-status-icon${isChild ? ' mo2-child-status-icon' : ''}`} title={t(statusCfg.key, { ns: 'common' })}>{STATUS_ICONS[getStatusIconKey(order.status, orderPhase)]}</span>}
              <span className={isChild ? 'mo2-child-name' : 'mo2-header-name'}>{order.space_name || t('untitledSpace')}</span>
            </div>
            <div className="mo2-header-bottom">
              <span className={isChild ? 'mo2-child-price' : 'mo2-header-price'}>&#8362;{order.total_cost.toFixed(2)}</span>
            </div>
          </div>

          {/* Right: actions + chevron */}
          <div className="mo2-header-right">
            {isChild ? (
              <>
                <div className="mo2-child-actions mo2-actions-desktop">
                  {canEdit && (
                    <button className="mo2-header-action mo2-child-action" onClick={e => { e.stopPropagation(); onEdit(order); }} title={t('editOrder')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                  {(canEdit || (!isUpcoming && isPending)) && (
                    <button className="mo2-header-action mo2-child-action mo2-header-action-cancel" onClick={e => { e.stopPropagation(); onCancel(order.id); }} title={t('cancelOrder')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  )}
                </div>
                <div className="mo2-actions-mobile">
                  <ThreeDotMenu actions={[
                    ...(canEdit ? [{ label: t('editOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, onClick: () => onEdit(order) }] : []),
                    ...((canEdit || (!isUpcoming && isPending)) ? [{ label: t('cancelOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>, onClick: () => onCancel(order.id), variant: 'danger' as const }] : []),
                  ]} />
                </div>
              </>
            ) : (
              <>
                <div className="mo2-actions-desktop">
                  {canEdit && (
                    <button className="mo2-header-action" onClick={e => { e.stopPropagation(); onEdit(order); }} title={t('editOrder')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span className="mo2-header-action-label">{t('editOrder')}</span>
                    </button>
                  )}
                  {onDuplicate && !hideDuplicate && order.status === 'pending' && (
                    <button className="mo2-header-action" onClick={e => { e.stopPropagation(); onDuplicate(order); }} title={t('duplicateToSpace')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      <span className="mo2-header-action-label">{t('duplicateToSpace')}</span>
                    </button>
                  )}
                  {(canEdit || (!isUpcoming && isPending)) && (
                    <button className="mo2-header-action mo2-header-action-cancel" onClick={e => { e.stopPropagation(); onCancel(order.id); }} title={t('cancelOrder')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      <span className="mo2-header-action-label">{t('cancelOrder')}</span>
                    </button>
                  )}
                </div>
                <div className="mo2-actions-mobile">
                  <ThreeDotMenu actions={[
                    ...(canEdit ? [{ label: t('editOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, onClick: () => onEdit(order) }] : []),
                    ...(onDuplicate && !hideDuplicate && order.status === 'pending' ? [{ label: t('duplicateToSpace'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>, onClick: () => onDuplicate(order) }] : []),
                    ...((canEdit || (!isUpcoming && isPending)) ? [{ label: t('cancelOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>, onClick: () => onCancel(order.id), variant: 'danger' as const }] : []),
                  ]} />
                </div>
              </>
            )}
            <svg className={`mo2-card-chevron${isExpanded ? ' rotated' : ''}`} width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {/* Progress bar for active orders */}
      {!hideRow && isActive && progress && (
        <div className="mo2-progress">
          <div className="mo2-progress-header">
            <span className="mo2-progress-day-label">
              {t('dayXofY', { current: progress.completedDates + 1, total: progress.totalDates })}
            </span>
            <span className="mo2-progress-percent">{progress.percent}%</span>
          </div>
          <div className="mo2-progress-bar">
            <div className="mo2-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="mo2-progress-details">
            <span className="mo2-progress-stat">
              {t('datesCompleted', { done: progress.completedDates, total: progress.totalDates })}
            </span>
            <span className="mo2-progress-remaining">
              {t('daysRemaining', { count: progress.remainingCalendarDays })}
            </span>
          </div>
        </div>
      )}

      {/* Countdown for approved/confirmed orders not yet started */}
      {!hideRow && showCountdown && countdown && (countdown.days > 0 || countdown.hours > 0 || countdown.minutes > 0) && (
        <div className="mo2-countdown">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{t('startsInCountdown', { days: countdown.days, hours: countdown.hours, minutes: countdown.minutes })}</span>
        </div>
      )}

      {/* ── Expanded detail ── */}
      <div className={`mo2-detail${(isExpanded || hideRow) ? ' open' : ''}`}>
        <div className="mo2-detail-inner">

          {/* Two-column: Data left, Media right */}
          <div className="mo2-detail-columns">

            {/* ── Left: Dates + Hours + Schedule + Notes ── */}
            <div className="mo2-detail-col-left">

              <div className="mo2-detail-field">
                <div className="mo2-detail-field-label">{t('stepDates')}</div>
                <div className="mo2-detail-field-value">
                  {new Date(order.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  {order.start_date !== order.end_date && ` — ${new Date(order.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                </div>
              </div>

              <div className="mo2-detail-field">
                <div className="mo2-detail-field-label">{t('totalHoursLabel')}</div>
                <div className="mo2-detail-field-value">{totalHours} {t('totalHours', { count: totalHours }).replace(String(totalHours), '').trim()}</div>
              </div>

              {byDow.size > 0 && (() => {
                const groupedSchedule = groupScheduleByHours(byDow);
                return groupedSchedule.length > 0 ? (
                  <div className="mo2-detail-field">
                    <div className="mo2-detail-field-label">{t('schedule')}</div>
                    <div className="mo2-schedule">
                      {groupedSchedule.map((g, i) => (
                        <div key={i} className="mo2-schedule-row">
                          <span className="mo2-schedule-day">{g.dayLabel}</span>
                          <span className="mo2-schedule-range">{g.times}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {order.notes && (
                <div className="mo2-detail-field">
                  <div className="mo2-detail-field-label">{t('notes')}</div>
                  <p className="mo2-notes">{order.notes}</p>
                </div>
              )}
            </div>

            {/* ── Right: Media ── */}
            <div className="mo2-detail-col-right">
              {creativesMap[order.id] && creativesMap[order.id].length > 0 && (
                <>
                  <div className="mo2-detail-field-label">{t('uploadedMedia')}</div>
                  <div className="mo2-creatives">
                    {creativesMap[order.id].map(c => (
                      <div key={c.id} className="mo2-creative" onClick={() => window.open(`${API_URL}${c.file_url}`, '_blank')}>
                        {c.file_type === 'image' ? (
                          <img src={`${API_URL}${c.file_url}`} alt="Creative" />
                        ) : (
                          <VideoThumbnail source={`${API_URL}${c.file_url}`} />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ───────────────────────────────────────────────────
   Active Order Tile — always-visible dashboard card
   ─────────────────────────────────────────────────── */
function ActiveOrderTile({
  order,
  creativesMap,
}: {
  order: OrderListItem;
  creativesMap: Record<number, Creative[]>;
}) {
  const { t } = useTranslation('orders');
  const progress = getProgressInfo(order);
  const creatives = creativesMap[order.id] || [];

  const bookedDate = new Date(order.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="active-tile">
      {/* Header: name + booked date */}
      <div className="active-tile-header">
        <span className="active-tile-name">{order.space_name || t('untitledSpace')}</span>
        <span className="active-tile-booked">{t('bookedOn', { date: bookedDate })}</span>
      </div>

      {/* Progress bar */}
      <div className="active-tile-progress">
        <div className="active-tile-progress-header">
          <span className="active-tile-progress-label">
            {progress.percent}% {t('completed', { ns: 'common', defaultValue: 'Completed' })}
          </span>
        </div>
        <div className="active-tile-progress-bar">
          <div className="active-tile-progress-fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="active-tile-progress-meta">
          <span>{t('dayXofY', { current: progress.completedDates + 1, total: progress.totalDates })}</span>
          <span>{t('daysRemaining', { count: progress.remainingCalendarDays })}</span>
        </div>
      </div>

      {/* Media thumbnails (max 5, compact) */}
      {creatives.length > 0 && (
        <div className="active-tile-media-row">
          {creatives.slice(0, 5).map(c => (
            <div key={c.id} className="active-tile-media-thumb" onClick={() => window.open(`${API_URL}${c.file_url}`, '_blank')}>
              {c.file_type === 'image' ? (
                <img src={`${API_URL}${c.file_url}`} alt="Creative" />
              ) : (
                <VideoThumbnail source={`${API_URL}${c.file_url}`} />
              )}
            </div>
          ))}
          {creatives.length > 5 && (
            <span className="active-tile-media-overflow">+{creatives.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}


const isCampaignAdvanced = (order: OrderListItem): boolean => {
  if (!order.child_orders || order.child_orders.length === 0) return false;
  const allOrders = [order, ...order.child_orders];
  const firstStart = allOrders[0].start_date;
  const firstEnd = allOrders[0].end_date;
  return allOrders.some(o => o.start_date !== firstStart || o.end_date !== firstEnd);
};

export default function MyOrders() {
  const navigate = useNavigate();
  const { t } = useTranslation('orders');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creativesMap, setCreativesMap] = useState<Record<number, Creative[]>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<OrderPhase>('active');

  // Pagination per tab
  const [tabPages, setTabPages] = useState<Record<OrderPhase, number>>({ active: 1, approved: 1, upcoming: 1, completed: 1, cancelled: 1 });

  // Timeline state
  const [timelineOrderId, setTimelineOrderId] = useState<number | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<OrderEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Cancel dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Duplicate modal
  const [duplicateOrder, setDuplicateOrder] = useState<OrderListItem | null>(null);
  const [campaignTemplate, setCampaignTemplate] = useState<{ slots: ScheduleSlot[] } | null>(null);

  // Advanced add-space modal
  const [advancedAddOrder, setAdvancedAddOrder] = useState<OrderListItem | null>(null);

  // Fetch campaign schedule template when duplicate modal opens
  useEffect(() => {
    if (!duplicateOrder) { setCampaignTemplate(null); return; }
    const cid = duplicateOrder.campaign_id;
    if (!cid) { setCampaignTemplate(null); return; }
    getCampaignDetail(cid)
      .then(detail => setCampaignTemplate(detail.schedule_template ?? null))
      .catch(() => setCampaignTemplate(null));
  }, [duplicateOrder]);

  // Campaign expand/collapse
  const [expandedCampaignId, setExpandedCampaignId] = useState<number | null>(null);

  // Single-order expand/collapse (mirrors campaign structure)
  const [expandedSingleId, setExpandedSingleId] = useState<number | null>(null);

  // Sort
  const [sortDate, setSortDate] = useState<'newest' | 'oldest'>('newest');
  const [sortPrice, setSortPrice] = useState<'priceHigh' | 'priceLow' | 'none'>('none');

  // Delete campaign dialog
  const [cancelCampaignOpen, setCancelCampaignOpen] = useState(false);
  const [cancelCampaignId, setCancelCampaignId] = useState<number | null>(null);
  const [cancelCampaignLoading, setCancelCampaignLoading] = useState(false);

  const loadCreativesForOrders = (data: OrderListItem[]) => {
    data.forEach(order => {
      getCreatives(order.id).then(creatives => {
        if (creatives.length > 0) setCreativesMap(prev => ({ ...prev, [order.id]: creatives }));
      });
      if (order.child_orders) {
        order.child_orders.forEach(child => {
          getCreatives(child.id).then(creatives => {
            if (creatives.length > 0) setCreativesMap(prev => ({ ...prev, [child.id]: creatives }));
          });
        });
      }
    });
  };

  const refreshOrders = () => {
    getMyOrders().then(data => {
      setOrders(data);
      loadCreativesForOrders(data);
    });
  };

  useEffect(() => {
    getMyOrders().then(data => {
      setOrders(data);
      loadCreativesForOrders(data);
    }).finally(() => setLoading(false));
  }, []);

  const sortedOrders = useMemo(() => {
    const getCost = (o: OrderListItem) => {
      const parentCost = o.total_cost;
      const children = o.child_orders || [];
      const activeCost = (o.status !== 'cancelled' ? parentCost : 0) + children.filter(c => c.status !== 'cancelled').reduce((s, c) => s + c.total_cost, 0);
      // Fallback to full total when all orders are cancelled
      if (activeCost === 0 && (o.status === 'cancelled' || children.length > 0)) {
        return parentCost + children.reduce((s, c) => s + c.total_cost, 0);
      }
      return activeCost;
    };
    return [...orders].sort((a, b) => {
      // Price sort takes priority when active
      if (sortPrice !== 'none') {
        const diff = sortPrice === 'priceHigh' ? getCost(b) - getCost(a) : getCost(a) - getCost(b);
        if (diff !== 0) return diff;
      }
      // Date sort as primary (when no price) or tiebreaker
      return sortDate === 'oldest'
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders, sortDate, sortPrice]);

  const groupedOrders = useMemo(() => {
    const groups: Record<OrderPhase, OrderListItem[]> = { approved: [], upcoming: [], active: [], completed: [], cancelled: [] };
    for (const o of sortedOrders) {
      const isCampaign = o.child_orders && o.child_orders.length > 0;
      if (isCampaign) {
        // For campaigns, derive phase from non-cancelled orders so that
        // cancelling one order doesn't move the entire campaign to "cancelled".
        const allOrders = [o, ...(o.child_orders || [])];
        const activeOrders = allOrders.filter(c => c.status !== 'cancelled');
        if (activeOrders.length === 0) {
          groups.cancelled.push(o);
        } else {
          // Pick the "best" phase among non-cancelled orders by priority
          const PHASE_PRIORITY: OrderPhase[] = ['active', 'approved', 'upcoming', 'completed'];
          const phases = activeOrders.map(c => getOrderPhase({
            start_date: c.start_date,
            end_date: c.end_date,
            status: c.status,
            time_slots: c.time_slots || [],
          }));
          const best = PHASE_PRIORITY.find(p => phases.includes(p)) || 'upcoming';
          groups[best].push(o);
        }
      } else {
        groups[getOrderPhase(o)].push(o);
      }
    }
    return groups;
  }, [sortedOrders]);

  // Auto-select first non-empty tab when data loads
  useEffect(() => {
    for (const tab of TAB_ORDER) {
      if (groupedOrders[tab].length > 0) { setActiveTab(tab); return; }
    }
  }, [orders.length]); // only on initial load / data change

  // Reset pagination when tab changes
  const handleTabChange = (tab: OrderPhase) => {
    setActiveTab(tab);
    setTabPages(prev => ({ ...prev, [tab]: 1 }));
  };

  const currentOrders = groupedOrders[activeTab];
  const currentPage = tabPages[activeTab];
  const totalPages = Math.max(1, Math.ceil(currentOrders.length / ORDERS_PER_PAGE));
  const paginatedOrders = currentOrders.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);

  const goToPage = (page: number) => {
    setTabPages(prev => ({ ...prev, [activeTab]: page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelOpen = (orderId: number) => { setCancelOrderId(orderId); setCancelOpen(true); };

  const handleCancelConfirm = async () => {
    if (cancelOrderId === null) return;
    setCancelLoading(true);
    try {
      await cancelOrder(cancelOrderId);
      setOrders(prev => prev.map(o => {
        if (o.id === cancelOrderId) return { ...o, status: 'cancelled' };
        if (o.child_orders && o.child_orders.some(c => c.id === cancelOrderId)) {
          return { ...o, child_orders: o.child_orders.map(c => c.id === cancelOrderId ? { ...c, status: 'cancelled' } : c) };
        }
        return o;
      }));
      setCancelOpen(false);
    } catch { /* */ } finally { setCancelLoading(false); }
  };

  const handleCancelCampaignOpen = (campaignId: number) => { setCancelCampaignId(campaignId); setCancelCampaignOpen(true); };

  const handleCancelCampaignConfirm = async () => {
    if (cancelCampaignId === null) return;
    setCancelCampaignLoading(true);
    try {
      await cancelCampaign(cancelCampaignId);
      // Mark all orders in this campaign as cancelled in local state
      setOrders(prev => prev.map(o => {
        if (o.campaign_id !== cancelCampaignId) return o;
        return {
          ...o,
          status: 'cancelled',
          child_orders: o.child_orders?.map(c =>
            c.campaign_id === cancelCampaignId ? { ...c, status: 'cancelled' } : c
          ),
        };
      }));
      setCancelCampaignOpen(false);
    } catch { /* */ } finally { setCancelCampaignLoading(false); }
  };

  const handleEditOrder = (order: OrderListItem | ChildOrderItem) => {
    navigate(`/book/${order.space_id}?type=${order.booking_type}&edit=${order.id}`);
  };

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id);

  const toggleTimeline = (orderId: number) => {
    if (timelineOrderId === orderId) { setTimelineOrderId(null); setTimelineEvents([]); return; }
    setTimelineOrderId(orderId);
    setTimelineLoading(true);
    getOrderTimeline(orderId).then(setTimelineEvents).catch(() => setTimelineEvents([])).finally(() => setTimelineLoading(false));
  };

  const childToOrderListItem = (child: ChildOrderItem, parentOrder: OrderListItem): OrderListItem => ({
    ...child,
    space_image: child.space_image,
    notes: child.notes,
    created_at: child.created_at || parentOrder.created_at,
    campaign_id: parentOrder.campaign_id,
    child_orders: [],
    time_slots: child.time_slots || [],
  });

  function deriveCampaignStatus(order: OrderListItem): string {
    const allOrders = [order, ...(order.child_orders || []).map(c => childToOrderListItem(c, order))];
    if (allOrders.some(o => o.status === 'confirmed')) return 'confirmed';
    if (allOrders.some(o => o.status === 'approved')) return 'approved';
    if (allOrders.some(o => o.status === 'pending')) return 'pending';
    if (allOrders.some(o => o.status === 'completed')) return 'completed';
    return 'cancelled';
  }

  function renderOrderOrCampaign(order: OrderListItem, phase: OrderPhase) {
    const isCampaign = order.child_orders && order.child_orders.length > 0;

    /* ── Active phase: render as always-visible data tiles ── */
    if (phase === 'active') {
      if (isCampaign) {
        const allOrders = [order, ...(order.child_orders || []).map(c => childToOrderListItem(c, order))];
        const activeOrders = allOrders.filter(o => o.status !== 'cancelled');

        return (
          <React.Fragment key={order.id}>
            {activeOrders.map(o => (
              <ActiveOrderTile
                key={o.id}
                order={o}
                creativesMap={creativesMap}
              />
            ))}
          </React.Fragment>
        );
      }

      return (
        <ActiveOrderTile
          key={order.id}
          order={order}
          creativesMap={creativesMap}
        />
      );
    }

    if (isCampaign) {
      const campaignStatus = deriveCampaignStatus(order);
      const statusCfg = STATUS_KEYS[campaignStatus] || STATUS_KEYS.pending;
      const isCampaignExpanded = expandedCampaignId === order.campaign_id;

      // Only allow Add Space and Cancel Campaign when campaign is pending
      const canAddSpace = campaignStatus === 'pending';
      const canCancelCampaign = campaignStatus === 'pending';
      const isAdvanced = isCampaignAdvanced(order);

      // Compute stats — fallback to allOrders when every order is cancelled
      const allOrders = [order, ...(order.child_orders || []).map(c => childToOrderListItem(c, order))];
      const activeOrders = allOrders.filter(o => o.status !== 'cancelled');
      const statsOrders = activeOrders.length > 0 ? activeOrders : allOrders;
      const campaignTotal = statsOrders.reduce((s, o) => s + o.total_cost, 0);
      const campaignCount = statsOrders.length;
      const isCampaignCancelled = activeOrders.length === 0;

      // Compute date range across non-cancelled orders
      const ordersForRange = activeOrders.length > 0 ? activeOrders : allOrders;
      const startDates = ordersForRange.map(o => o.start_date).sort();
      const endDates = ordersForRange.map(o => o.end_date).sort();
      const dateRange = `${startDates[0]} — ${endDates[endDates.length - 1]}`;

      const allChildOrders = [order, ...(order.child_orders || []).map(c => childToOrderListItem(c, order))];

      return (
        <div key={order.id} className="mo2-campaign">
          {/* ── Campaign header ── */}
          <div className="mo2-campaign-header" onClick={() => setExpandedCampaignId(prev => prev === order.campaign_id ? null : order.campaign_id ?? null)}>
            {/* Icon column */}
            <div className={`mo2-icon-col${isCampaignExpanded ? ' mo2-icon-col-line' : ''}`}>
              <span className="mo2-status-icon" title={t(statusCfg.key, { ns: 'common' })}>{STATUS_ICONS[getStatusIconKey(campaignStatus, phase)]}</span>
            </div>

            {/* Content */}
            <div className="mo2-header-content">
              <div className="mo2-header-left">
                <span className={`mo2-header-name${isCampaignCancelled ? ' mo2-cancelled-text' : ''}`}>{t('spacesCountOnly', { count: campaignCount })}</span>
                <div className="mo2-header-bottom">
                  <span className={`mo2-header-price${isCampaignCancelled ? ' mo2-cancelled-text' : ''}`}>&#8362;{campaignTotal.toFixed(2)}</span>
                  <span className="mo2-header-meta-dot">·</span>
                  <span className="mo2-header-date">{t('booked', { date: new Date(order.created_at).toLocaleDateString() })}</span>
                </div>
              </div>

              <div className="mo2-header-right">
                <div className="mo2-actions-desktop">
                  {canAddSpace && (
                    <button className="mo2-header-action" onClick={e => {
                      e.stopPropagation();
                      if (isCampaignAdvanced(order)) { setAdvancedAddOrder(order); } else { setDuplicateOrder(order); }
                    }} title={t('addSpace')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      <span className="mo2-header-action-label">{t('addSpace')}</span>
                    </button>
                  )}
                  {order.campaign_id && canCancelCampaign && (
                    <button className="mo2-header-action mo2-header-action-cancel" onClick={e => { e.stopPropagation(); handleCancelCampaignOpen(order.campaign_id!); }} title={t('cancelCampaign')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      <span className="mo2-header-action-label">{t('cancelCampaign')}</span>
                    </button>
                  )}
                </div>
                <div className="mo2-actions-mobile">
                  <ThreeDotMenu actions={[
                    ...(canAddSpace ? [{ label: t('addSpace'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>, onClick: () => { if (isCampaignAdvanced(order)) { setAdvancedAddOrder(order); } else { setDuplicateOrder(order); } } }] : []),
                    ...(order.campaign_id && canCancelCampaign ? [{ label: t('cancelCampaign'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>, onClick: () => handleCancelCampaignOpen(order.campaign_id!), variant: 'danger' as const }] : []),
                  ]} />
                </div>
                <svg className={`mo2-card-chevron${isCampaignExpanded ? ' rotated' : ''}`} width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          {/* ── Expanded children with connector lines ── */}
          {isCampaignExpanded && (
            <div className="mo2-campaign-orders">
              {allChildOrders.map((childOrder, idx) => {
                const isLast = idx === allChildOrders.length - 1;
                const co = childOrder === order ? order : childOrder;
                const coPhase = getOrderPhase(co);
                return (
                  <div key={co.id} className="mo2-child-row-wrap">
                    <div className={`mo2-icon-col mo2-icon-col-child${isLast ? ' mo2-icon-col-child-last' : ''}`}>
                      <span className="mo2-connector-branch" />
                      <span className="mo2-status-icon mo2-child-status-icon" title={t((STATUS_KEYS[co.status] || STATUS_KEYS.pending).key, { ns: 'common' })}>{STATUS_ICONS[getStatusIconKey(co.status, coPhase)]}</span>
                    </div>
                    <div className="mo2-child-content">
                      <OrderCard
                        order={co}
                        creativesMap={creativesMap}
                        isExpanded={expandedId === co.id}
                        onToggleExpand={toggleExpand}
                        onEdit={co === order ? handleEditOrder : () => handleEditOrder(co)}
                        onCancel={handleCancelOpen}
                        onDuplicate={co.status === 'pending' ? () => setDuplicateOrder(co) : undefined}
                        hideDuplicate={!isAdvanced}
                        isChild
                        timelineOrderId={timelineOrderId}
                        timelineEvents={timelineEvents}
                        timelineLoading={timelineLoading}
                        onToggleTimeline={toggleTimeline}
                        phase={phase}
                        hideStatusIcon
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    const canDuplicate = order.status === 'pending';
    const singleStatusCfg = STATUS_KEYS[order.status] || STATUS_KEYS.pending;
    const isSingleExpanded = expandedSingleId === order.id;
    const singlePhase = phase || getOrderPhase(order);
    const singleCanEdit = singlePhase === 'upcoming' && order.status === 'pending';
    const isSingleCancelled = order.status === 'cancelled';

    return (
      <div key={order.id} className="mo2-campaign">
        {/* Single-order header with actions */}
        <div
          className="mo2-campaign-header"
          onClick={() => setExpandedSingleId(prev => prev === order.id ? null : order.id)}
        >
          {/* Icon column */}
          <div className="mo2-icon-col">
            <span className="mo2-status-icon" title={t(singleStatusCfg.key, { ns: 'common' })}>{STATUS_ICONS[getStatusIconKey(order.status, singlePhase)]}</span>
          </div>

          {/* Content */}
          <div className="mo2-header-content">
            <div className="mo2-header-left">
              <span className={`mo2-header-name${isSingleCancelled ? ' mo2-cancelled-text' : ''}`}>{order.space_name || t('untitledSpace')}</span>
              <div className="mo2-header-bottom">
                <span className={`mo2-header-price${isSingleCancelled ? ' mo2-cancelled-text' : ''}`}>&#8362;{order.total_cost.toFixed(2)}</span>
                <span className="mo2-header-meta-dot">·</span>
                <span className="mo2-header-date">{t('booked', { date: new Date(order.created_at).toLocaleDateString() })}</span>
              </div>
            </div>
            <div className="mo2-header-right">
              <div className="mo2-actions-desktop">
                {singleCanEdit && (
                  <button className="mo2-header-action" onClick={e => { e.stopPropagation(); handleEditOrder(order); }} title={t('editOrder')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <span className="mo2-header-action-label">{t('editOrder')}</span>
                  </button>
                )}
                {canDuplicate && (
                  <button className="mo2-header-action" onClick={e => { e.stopPropagation(); setDuplicateOrder(order); }} title={t('duplicateToSpace')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    <span className="mo2-header-action-label">{t('duplicateToSpace')}</span>
                  </button>
                )}
                {(singleCanEdit || (singlePhase !== 'upcoming' && order.status === 'pending')) && (
                  <button className="mo2-header-action mo2-header-action-cancel" onClick={e => { e.stopPropagation(); handleCancelOpen(order.id); }} title={t('cancelOrder')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    <span className="mo2-header-action-label">{t('cancelOrder')}</span>
                  </button>
                )}
              </div>
              <div className="mo2-actions-mobile">
                <ThreeDotMenu actions={[
                  ...(singleCanEdit ? [{ label: t('editOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, onClick: () => handleEditOrder(order) }] : []),
                  ...(canDuplicate ? [{ label: t('duplicateToSpace'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>, onClick: () => setDuplicateOrder(order) }] : []),
                  ...((singleCanEdit || (singlePhase !== 'upcoming' && order.status === 'pending')) ? [{ label: t('cancelOrder'), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>, onClick: () => handleCancelOpen(order.id), variant: 'danger' as const }] : []),
                ]} />
              </div>
              <svg className={`mo2-card-chevron${isSingleExpanded ? ' rotated' : ''}`} width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        {/* Expanded detail directly (no intermediate OrderCard row) */}
        {isSingleExpanded && (
          <div className="mo2-single-expanded">
            <OrderCard
              order={order}
              creativesMap={creativesMap}
              isExpanded={true}
              onToggleExpand={() => {}}
              onEdit={handleEditOrder}
              onCancel={handleCancelOpen}
              onDuplicate={canDuplicate ? () => setDuplicateOrder(order) : undefined}
              timelineOrderId={timelineOrderId}
              timelineEvents={timelineEvents}
              timelineLoading={timelineLoading}
              onToggleTimeline={toggleTimeline}
              phase={phase}
              hideRow
            />
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="mo2-loading"><Loader variant="page" /></div>;
  }

  return (
    <div className="mo2-page">
      {/* Header */}
      <div className="mo2-header">
        <h1 className="mo2-title">{t('myOrders')}</h1>
      </div>

      {orders.length === 0 ? (
        <div className="mo2-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
          <p>{t('noBookingsYet')}</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="mo2-tabs">
            {TAB_ORDER.map(tab => (
              <button
                key={tab}
                className={`mo2-tab${activeTab === tab ? ' mo2-tab-active' : ''}${tab === 'active' && groupedOrders.active.length > 0 ? ' mo2-tab-live' : ''}${tab === 'approved' && groupedOrders.approved.length > 0 ? ' mo2-tab-approved-glow' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                <span className="mo2-tab-label">{t(`${tab}Orders`)}</span>
                <span className={`mo2-tab-count${groupedOrders[tab].length === 0 ? ' mo2-tab-count-zero' : ''}`}>{groupedOrders[tab].length}</span>
              </button>
            ))}
          </div>

          {/* Sort dropdowns */}
          <div className="mo2-sort-bar">
            <FilterDropdown
              value={sortDate}
              options={[
                { value: 'newest' as const, label: t('newestFirst') },
                { value: 'oldest' as const, label: t('oldestFirst') },
              ]}
              onChange={(v) => { setSortDate(v); setSortPrice('none'); }}
            />
            <FilterDropdown
              value={sortPrice}
              options={[
                { value: 'none' as const, label: t('price') },
                { value: 'priceHigh' as const, label: t('priceHighToLow') },
                { value: 'priceLow' as const, label: t('priceLowToHigh') },
              ]}
              onChange={(v) => setSortPrice(v)}
            />
          </div>

          {/* Content for active tab */}
          {currentOrders.length === 0 ? (
            <div className="mo2-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p>{t(`no${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}Orders`)}</p>
            </div>
          ) : (
            <>
              <div className="mo2-list">
                {paginatedOrders.map(order => renderOrderOrCampaign(order, activeTab))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mo2-pagination">
                  <button
                    className="mo2-page-btn mo2-page-arrow"
                    disabled={currentPage === 1}
                    onClick={() => goToPage(currentPage - 1)}
                    aria-label="Previous page"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      className={`mo2-page-btn${page === currentPage ? ' mo2-page-active' : ''}`}
                      onClick={() => goToPage(page)}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    className="mo2-page-btn mo2-page-arrow"
                    disabled={currentPage === totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    aria-label="Next page"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Cancel order modal */}
      {cancelOpen && (
        <AppModal
          title={t('cancelOrder')}
          message={t('cancelOrderConfirm')}
          type="confirm"
          variant="danger"
          confirmText={t('yesCancelOrder')}
          cancelText={t('keepOrder')}
          onConfirm={handleCancelConfirm}
          onCancel={() => !cancelLoading && setCancelOpen(false)}
        />
      )}

      {/* Cancel campaign modal */}
      {cancelCampaignOpen && (
        <AppModal
          title={t('cancelCampaign')}
          message={t('cancelCampaignConfirm')}
          type="confirm"
          variant="danger"
          confirmText={t('yesCancelOrder')}
          cancelText={t('keepCampaign')}
          onConfirm={handleCancelCampaignConfirm}
          onCancel={() => !cancelCampaignLoading && setCancelCampaignOpen(false)}
        />
      )}

      {/* Duplicate modal */}
      {duplicateOrder && (() => {
        const allCampaignOrders = [duplicateOrder, ...(duplicateOrder.child_orders || []).map(c => childToOrderListItem(c, duplicateOrder))];
        const nonCancelled = allCampaignOrders.filter(o => o.status !== 'cancelled');
        // Use a non-cancelled order as source (needs valid time slots for compatibility check)
        const sourceOrder = nonCancelled[0] || duplicateOrder;
        return (
          <DuplicateOrderModal
            orderId={sourceOrder.id}
            currentSpaceId={sourceOrder.space_id}
            orderData={{ booking_type: sourceOrder.booking_type, start_date: sourceOrder.start_date, end_date: sourceOrder.end_date, notes: sourceOrder.notes, campaign_id: duplicateOrder.campaign_id }}
            duplicatedSpaceIds={nonCancelled.map(o => o.space_id)}
            scheduleTemplate={campaignTemplate}
            open={!!duplicateOrder}
            onClose={() => setDuplicateOrder(null)}
            onDuplicated={() => refreshOrders()}
          />
        );
      })()}

      {advancedAddOrder && (
        <AddAdvancedSpaceModal
          campaignId={advancedAddOrder.campaign_id!}
          existingSpaceIds={[advancedAddOrder, ...(advancedAddOrder.child_orders || [])]
            .filter(c => c.status !== 'cancelled')
            .map(c => c.space_id)}
          open={!!advancedAddOrder}
          onClose={() => setAdvancedAddOrder(null)}
          onSuccess={() => { setAdvancedAddOrder(null); refreshOrders(); }}
        />
      )}
    </div>
  );
}
