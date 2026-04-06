import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DayPicker } from 'react-day-picker';
import { format, parse, startOfDay, addYears, addDays, addMonths } from 'date-fns';
import 'react-day-picker/style.css';
import Loader from './Loader';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  loading?: boolean;
  isEditMode?: boolean;
  hideHeader?: boolean;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  loading,
  isEditMode,
  hideHeader,
}: DateRangePickerProps) {
  const { t } = useTranslation('orders');
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const todayDate = startOfDay(new Date());
  const tomorrowDate = addDays(todayDate, 1);
  const [calendarMonth, setCalendarMonth] = useState<Date>(tomorrowDate);
  const [calSlideDir, setCalSlideDir] = useState<'left' | 'right' | null>(null);
  const [calSlideKey, setCalSlideKey] = useState(0);

  const navigateCalendar = useCallback((newMonth: Date) => {
    const dir = newMonth > calendarMonth ? 'left' : 'right';
    setCalSlideDir(dir);
    setCalSlideKey(k => k + 1);
    setCalendarMonth(newMonth);
  }, [calendarMonth]);

  return (
    <div className="bf-section bf-animate-in">
      {!hideHeader && (
        <>
          <h2 className="bf-step-title">{isEditMode ? t('changeCampaignDates') : t('campaignDuration')}</h2>
          {/* <p className="bf-step-desc">{t('selectCampaignDatesDesc')}</p> */}
        </>
      )}

      {/* Quick date range picks */}
        {!isEditMode && (
          <div className="bf-quick-picks">
            <span className="bf-quick-picks-label">{t('quickPick')}</span>
            <div className="bf-quick-picks-row">
              {(() => {
                const monthEndDate = addMonths(tomorrowDate, 1);
                const monthStart = format(tomorrowDate, 'yyyy-MM-dd');
                const monthEnd = format(monthEndDate, 'yyyy-MM-dd');
                const isMonthActive = startDate === monthStart && endDate === monthEnd;

                const halfYearEndDate = addMonths(tomorrowDate, 6);
                const halfYearStart = format(tomorrowDate, 'yyyy-MM-dd');
                const halfYearEnd = format(halfYearEndDate, 'yyyy-MM-dd');
                const isHalfYearActive = startDate === halfYearStart && endDate === halfYearEnd;

                const yearEndDate = addMonths(tomorrowDate, 12);
                const yearStart = format(tomorrowDate, 'yyyy-MM-dd');
                const yearEnd = format(yearEndDate, 'yyyy-MM-dd');
                const isYearActive = startDate === yearStart && endDate === yearEnd;

                const clearDates = () => { onStartDateChange(''); onEndDateChange(''); setActiveField(null); navigateCalendar(todayDate); };

                const applyQuick = (s: string, e: string, endDateObj: Date) => {
                  onStartDateChange(s);
                  onEndDateChange(e);
                  setActiveField(null);
                  navigateCalendar(endDateObj);
                };

                return (
                  <>
                    <button type="button" className={`bf-quick-pick ${isMonthActive ? 'active' : ''}`} onClick={() => { if (isMonthActive) { clearDates(); } else { applyQuick(monthStart, monthEnd, monthEndDate); } }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      {t('quickMonth')}
                    </button>
                    <button type="button" className={`bf-quick-pick ${isHalfYearActive ? 'active' : ''}`} onClick={() => { if (isHalfYearActive) { clearDates(); } else { applyQuick(halfYearStart, halfYearEnd, halfYearEndDate); } }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                      {t('quickHalfYear')}
                    </button>
                    <button type="button" className={`bf-quick-pick ${isYearActive ? 'active' : ''}`} onClick={() => { if (isYearActive) { clearDates(); } else { applyQuick(yearStart, yearEnd, yearEndDate); } }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                      {t('quickYear')}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

      <div className="bf-date-card">
        <div className="bf-date-fields">
          <div
            className={`bf-date-col bf-date-col-clickable${activeField === 'from' ? ' active' : ''}`}
            onClick={() => {
              const wasActive = activeField === 'from';
              setActiveField(wasActive ? null : 'from');
              if (!wasActive) navigateCalendar(todayDate);
            }}
          >
            <span className="bf-date-label">{t('start')}</span>
            <span className={`bf-date-value ${startDate ? 'has-value' : ''}${activeField === 'from' ? ' picking' : ''}`}>
              {activeField === 'from'
                ? t('pickOnCalendar')
                : startDate ? format(parse(startDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : t('select')}
            </span>
          </div>
          <div className="bf-date-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
          <div
            className={`bf-date-col bf-date-col-clickable${activeField === 'to' ? ' active' : ''}`}
            onClick={() => setActiveField(prev => prev === 'to' ? null : 'to')}
          >
            <span className="bf-date-label">{t('end')}</span>
            <span className={`bf-date-value ${endDate ? 'has-value' : ''}${activeField === 'to' ? ' picking' : ''}`}>
              {activeField === 'to'
                ? t('pickOnCalendar')
                : endDate ? format(parse(endDate, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy') : t('select')}
            </span>
          </div>
        </div>

        <div className="bf-cal-slide-wrap">
          <div
            key={calSlideKey}
            className={`bf-cal-slide ${calSlideDir === 'left' ? 'bf-cal-slide-left' : calSlideDir === 'right' ? 'bf-cal-slide-right' : ''}`}
            onAnimationEnd={() => setCalSlideDir(null)}
          >
            <DayPicker
              mode="range"
              navLayout="around"
              selected={startDate ? { from: parse(startDate, 'yyyy-MM-dd', new Date()), to: endDate ? parse(endDate, 'yyyy-MM-dd', new Date()) : undefined } : undefined}
              onSelect={(range, triggerDate) => {
                if (activeField && triggerDate) {
                  const formatted = format(triggerDate, 'yyyy-MM-dd');
                  if (activeField === 'from') {
                    onStartDateChange(formatted);
                    if (endDate && formatted > endDate) onEndDateChange('');
                  } else {
                    if (startDate && formatted < startDate) {
                      onStartDateChange(formatted);
                      onEndDateChange('');
                    } else {
                      onEndDateChange(formatted);
                    }
                  }
                  setActiveField(null);
                } else {
                  onStartDateChange(range?.from ? format(range.from, 'yyyy-MM-dd') : '');
                  onEndDateChange(range?.to ? format(range.to, 'yyyy-MM-dd') : '');
                }
              }}
              disabled={[{ before: tomorrowDate }]}
              modifiers={{ unavailable: { before: tomorrowDate } }}
              modifiersClassNames={{ unavailable: 'rdp-sold-out' }}
              month={calendarMonth}
              onMonthChange={navigateCalendar}
              startMonth={todayDate}
              endMonth={addYears(todayDate, 1)}
              className="bf-day-picker bf-range-picker"
            />
          </div>
        </div>
      </div>

      {/* Loading availability indicator */}
      {loading && (
        <div className="bf-loading-availability">
          <Loader variant="inline" />
          <span>{t('loadingAvailability')}</span>
        </div>
      )}
    </div>
  );
}
