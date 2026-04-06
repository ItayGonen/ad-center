import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ModalProvider } from './context/ModalContext';
import { CampaignProvider } from './context/CampaignContext';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getSpaces } from './services/spaces';
import type { SpaceListItem } from './services/spaces';
import { getNotifications, markAsRead, markAllAsRead, clearAllNotifications } from './services/notifications';
import type { Notification as NotifItem } from './services/notifications';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { API_URL, getPublicSettings } from './services/api';
import Login from './pages/Login';
import Register from './pages/Register';
import CompleteProfile from './pages/CompleteProfile';
import Locations from './pages/Locations';
import LocationDetail from './pages/LocationDetail';
import BookingFlow from './pages/BookingFlow';
import MyOrders from './pages/MyOrders';
import CreateCampaign from './pages/CreateCampaign';
import AdvancedBookingFlow from './pages/AdvancedBookingFlow';
import AdminUsers from './pages/AdminUsers';
import AdminSpaces from './pages/AdminSpaces';
import AdminSpaceEdit from './pages/AdminSpaceEdit';
import AdminOrders from './pages/AdminOrders';
import MapView from './pages/MapView';
import Settings from './pages/Settings';
import AdminNotifications from './pages/AdminNotifications';
import AdminTranslations from './pages/AdminTranslations';
import AdminSettings from './pages/AdminSettings';
import AdminCalendar from './pages/AdminCalendar';
import MyCreatives from './pages/MyCreatives';
import PartnerDashboard from './pages/PartnerDashboard';
import PartnerProfile from './pages/PartnerProfile';
import Loader from './components/Loader';
import './App.css';
import './rtl.css';

/* ── SVG Icons ── */
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
);
const IconMap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);
const IconCart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
);
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
);
const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
);
const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
);
const IconCreatives = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
);
const IconCampaign = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="3" y="3" width="7" height="7" rx="1"/></svg>
);
const IconBuilding = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>
);
const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);
function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  // Backend stores UTC but omits the Z suffix — force UTC parsing
  const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  const d = new Date(utcStr).getTime();
  const diff = Math.max(0, now - d);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(utcStr).toLocaleDateString();
}

function getInitials(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

/* ── Sidebar / Bottom Nav ── */
function useNavItems() {
  const { isAuthenticated, user } = useAuth();
  const { t } = useTranslation('common');

  if (user?.role === 'partner') {
    return [
      { to: '/partner/dashboard', icon: <IconBuilding />, label: t('dashboard'), match: (p: string) => p.startsWith('/partner') },
    ];
  }

  return [
    { to: '/', icon: <IconGrid />, label: t('browseSpaces'), match: (p: string) => p === '/' || p.startsWith('/location') },
    { to: '/map', icon: <IconMap />, label: t('showMap'), match: (p: string) => p === '/map' },
    ...(isAuthenticated ? [
      { to: '/create-campaign', icon: <IconCampaign />, label: t('createCampaign'), match: (p: string) => p === '/create-campaign' },
      { to: '/my-creatives', icon: <IconCreatives />, label: t('myCreatives', { ns: 'creatives' }), match: (p: string) => p === '/my-creatives' },
    ] : []),
  ];
}

function Sidebar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const location = useLocation();
  const path = location.pathname;
  const items = useNavItems();

  return (
    <aside className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-toggle-row">
          <button className="sidebar-toggle-btn" onClick={onToggle} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
            <span className="sidebar-toggle-icon">
              {expanded ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
            </span>
          </button>
        </div>
        {items.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={`sidebar-item ${item.match(path) ? 'active' : ''}`}
            title={!expanded ? item.label : undefined}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}

function BottomNav() {
  const location = useLocation();
  const path = location.pathname;
  const items = useNavItems();

  return (
    <nav className="bottom-nav">
      {items.map(item => {
        const isActive = item.match(path);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
            {isActive && <span className="bottom-nav-indicator" />}
          </Link>
        );
      })}
    </nav>
  );
}

/* ── Top Bar ── */
function TopBar({ search, onSearch, hideSearch }: { search: string; onSearch: (v: string) => void; hideSearch?: boolean }) {
  const { isAuthenticated, user, logout } = useAuth();
  const { t } = useTranslation('common');
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [focused, setFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // User menu dropdown
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  function handleClearAll() {
    if (clearing) return;
    setClearing(true);
    const delay = Math.min(notifications.length * 80, 600) + 300;
    clearAllNotifications().catch(() => {});
    setTimeout(() => {
      setNotifications([]);
      setUnreadCount(0);
      setClearing(false);
      setNotifOpen(false);
    }, delay);
  }

  const fetchNotifications = useCallback(() => {
    if (!isAuthenticated) return;
    getNotifications().then(data => {
      setNotifications(data.items);
      setUnreadCount(data.unread_count);
    }).catch(() => {});
  }, [isAuthenticated]);

  // Poll every 10s + on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchNotifications]);

  // Refetch when dropdown opens
  useEffect(() => {
    if (notifOpen) fetchNotifications();
  }, [notifOpen, fetchNotifications]);

  // Refresh spaces list every time the search input is focused
  function loadSpaces() {
    getSpaces().then(setSpaces).catch(() => {});
  }

  useEffect(() => { loadSpaces(); }, []);

  // Load accent color from backend
  useEffect(() => {
    getPublicSettings()
      .then(data => {
        document.documentElement.style.setProperty('--accent', data.accent_color);
      })
      .catch(() => {
        document.documentElement.style.setProperty('--accent', '#e61e4d');
      });
  }, []);

  // close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleFocus() {
    setFocused(true);
    loadSpaces();
  }

  const results = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return spaces.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [search, spaces]);

  const showDropdown = focused && search.trim().length > 0;

  // Reset highlight when results change
  useEffect(() => { setHighlightIdx(-1); }, [results]);

  function selectResult(id: number) {
    setFocused(false);
    setHighlightIdx(-1);
    onSearch('');
    // Use replace when already on a location page to force re-render
    const isOnLocation = window.location.pathname.startsWith('/location/');
    navigate(`/location/${id}`, { replace: isOnLocation });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setFocused(false); return; }
    if (!showDropdown || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = highlightIdx >= 0 ? highlightIdx : 0;
      selectResult(results[idx].id);
    }
  }

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        <img src="/logo.svg" alt="Leads" className="topbar-logo" />
      </Link>

      {!hideSearch && (
        <div className="topbar-search-area">
          <div className="topbar-search" ref={wrapRef}>
            <span className="topbar-search-icon"><IconSearch /></span>
            <input
              type="text"
              placeholder={t('searchSpaces')}
              value={search}
              onChange={e => { onSearch(e.target.value); if (!focused) setFocused(true); }}
              onFocus={handleFocus}
              onKeyDown={handleSearchKeyDown}
              role="combobox"
              aria-expanded={showDropdown}
              aria-autocomplete="list"
            />
            {showDropdown && (
              <div className="search-dropdown" role="listbox">
                {results.length === 0 ? (
                  <div className="search-empty">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    {t('noSpacesFound')}
                  </div>
                ) : (
                  results.map((space, i) => (
                    <button
                      key={space.id}
                      className={`search-result${i === highlightIdx ? ' highlighted' : ''}`}
                      onClick={() => selectResult(space.id)}
                      onMouseEnter={() => setHighlightIdx(i)}
                      role="option"
                      aria-selected={i === highlightIdx}
                    >
                      <div className="search-result-thumb">
                        {space.first_image ? (
                          <img src={`${API_URL}${space.first_image}`} alt="" />
                        ) : (
                          <span>?</span>
                        )}
                      </div>
                      <div className="search-result-info">
                        <span className="search-result-title">{space.name}</span>
                        <span className="search-result-meta">
                          {space.city && <>{space.city} · </>}&#8362;{space.price_per_day}/day
                        </span>
                      </div>
                      <svg className="search-result-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {/* <button className="topbar-filter-btn" title="Filters">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
          </button> */}
        </div>
      )}

      <div className="topbar-right">
        {isAuthenticated ? (
          <div className="topbar-user" ref={menuRef}>
            {user?.role === 'admin' && <span className="topbar-admin-badge">{t('admin')}</span>}
            {user?.role === 'partner' && <span className="topbar-partner-badge">{t('partner')}</span>}

            {/* Notification Bell */}
            <div className="notif-wrapper" ref={notifRef}>
              <button className={`notif-bell${notifOpen ? ' active' : ''}`} onClick={() => setNotifOpen(!notifOpen)} title="Notifications">
                <IconBell />
                {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>

              {notifOpen && (
                <div className="notif-dropdown">
                  <div className="notif-header">
                    <span className="notif-header-title">{t('notifications')}</span>
                    <div className="notif-header-actions">
                      {unreadCount > 0 && (
                        <button className="notif-chip notif-chip-accent" onClick={() => { markAllAsRead().then(fetchNotifications); }}>
                          {t('markAllRead')}
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button className="notif-chip notif-chip-gray" onClick={handleClearAll} disabled={clearing}>
                          {t('clearAllNotif')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="notif-list">
                    {notifications.length === 0 ? (
                      <div className="notif-empty">{t('noNotifications')}</div>
                    ) : (
                      notifications.map((n, i) => {
                        const isSuccess = ['order_created', 'order_approved', 'order_confirmed', 'order_completed'].includes(n.type);
                        const isCancelled = n.type === 'order_cancelled';
                        const notifColor = (() => {
                          if (n.type === 'admin_broadcast' && n.title) {
                            const m = n.title.match(/^\[(INFO|WARNING|PROMOTION|SYSTEM_UPDATE)\]\s*/);
                            if (m) {
                              const map: Record<string, string> = { INFO: '#2563eb', WARNING: '#d97706', PROMOTION: '#7c3aed', SYSTEM_UPDATE: '#64748b' };
                              return map[m[1]] || '#2563eb';
                            }
                            return '#2563eb';
                          }
                          if (isCancelled) return '#dc2626';
                          if (isSuccess) return '#16a34a';
                          return '#2563eb';
                        })();

                        return (
                          <button
                            key={n.id}
                            className={`notif-item${!n.is_read ? ' unread' : ''}${clearing ? ' clearing' : ''}`}
                            style={clearing ? { animationDelay: `${i * 80}ms` } : undefined}
                            onClick={() => {
                              if (clearing) return;
                              if (!n.is_read) markAsRead(n.id).then(fetchNotifications);
                              setNotifOpen(false);
                              if (n.link) {
                                window.open(n.link, '_blank', 'noopener');
                              } else if (n.related_order_id) {
                                navigate(user?.role === 'partner' ? '/partner/dashboard' : '/orders');
                              }
                            }}
                          >
                            <span className="notif-color-bar" style={{ background: notifColor }} />
                            <span className={`notif-icon ${isCancelled ? 'notif-icon-cancel' : 'notif-icon-success'}`}>
                              {isCancelled ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                              ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                              )}
                            </span>
                            <div className="notif-item-body">
                              <span className="notif-item-message">{n.message}</span>
                              <span className="notif-item-time">{formatTimeAgo(n.created_at)}</span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <button className="topbar-avatar-btn" onClick={() => setMenuOpen(!menuOpen)}>
              <div className="topbar-avatar">
                {user?.profile_picture ? (
                  <img src={`${API_URL}${user.profile_picture}`} alt={user.name} />
                ) : (
                  getInitials(user?.name)
                )}
              </div>
            </button>

            {menuOpen && (
              <div className="user-menu">
                <div className="user-menu-header">
                  <div className="user-menu-avatar">
                    {user?.profile_picture ? (
                      <img src={`${API_URL}${user.profile_picture}`} alt={user.name} />
                    ) : (
                      getInitials(user?.name)
                    )}
                  </div>
                  <div className="user-menu-info">
                    <span className="user-menu-name">{user?.name}</span>
                    <span className="user-menu-email">{user?.email}</span>
                  </div>
                </div>
                <div className="user-menu-divider" />
                {user?.role !== 'partner' && (
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/orders'); }}>
                    <IconCart />
                    <span>{t('myOrders')}</span>
                  </button>
                )}
                <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/settings'); }}>
                  <IconGear />
                  <span>{t('settings')}</span>
                </button>
                {user?.role === 'partner' && (
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/partner/dashboard'); }}>
                    <IconBuilding />
                    <span>{t('partnerDashboard')}</span>
                  </button>
                )}
                {user?.role === 'admin' && (
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/admin/users'); }}>
                    <IconShield />
                    <span>{t('adminPanel')}</span>
                  </button>
                )}
                <div className="user-menu-divider" />
                <button className="user-menu-item user-menu-logout" onClick={() => { setMenuOpen(false); logout(); navigate('/', { replace: true }); }}>
                  <IconLogout />
                  <span>{t('logout')}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/login" className="topbar-login">{t('login')}</Link>
        )}
      </div>
    </header>
  );
}

/* ── Route Guards ── */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <Loader variant="page" />;
  if (!isAuthenticated) return <Navigate to="/" />;
  if (!user?.phone_number || !user?.company_name) return <Navigate to="/complete-profile" />;
  return <>{children}</>;
}

/** Redirects partner users from / to their dashboard */
function HomeRedirect({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'partner') return <Navigate to="/partner/dashboard" />;
  return <>{children}</>;
}

/** Blocks partner users from customer-only routes (booking, orders, campaigns) */
function CustomerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <Loader variant="page" />;
  if (!isAuthenticated) return <Navigate to="/" />;
  if (user?.role === 'partner') return <Navigate to="/partner/dashboard" />;
  if (!user?.phone_number || !user?.company_name) return <Navigate to="/complete-profile" />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <Loader variant="page" />;
  if (!isAuthenticated) return <Navigate to="/" />;
  if (user?.role !== 'admin') return <Navigate to="/" />;
  return <>{children}</>;
}

function PartnerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <Loader variant="page" />;
  if (!isAuthenticated) return <Navigate to="/" />;
  if (user?.role !== 'partner') return <Navigate to="/" />;
  return <>{children}</>;
}

/* ── App Shell ── */
function AppShell() {
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebar-expanded') === 'true');
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-expanded', String(next));
      return next;
    });
  }, []);
  const location = useLocation();
  const { isAuthenticated, user, loading } = useAuth();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/complete-profile';

  // Force incomplete-profile users to /complete-profile regardless of route
  if (!loading && isAuthenticated && (!user?.phone_number || !user?.company_name) && !isAuthPage) {
    return <Navigate to="/complete-profile" replace />;
  }

  if (isAuthPage) {
    return (
      <main className="auth-fullpage">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
        </Routes>
      </main>
    );
  }

  const isBookingFlow = location.pathname.startsWith('/book/') || location.pathname === '/book-advanced';
  const isSettingsPage = location.pathname === '/settings';
  const hideChrome = isBookingFlow || isSettingsPage;

  return (
    <div className="app-layout">
      {!hideChrome && <Sidebar expanded={sidebarOpen} onToggle={toggleSidebar} />}
      <div className="app-main">
        {!hideChrome && <TopBar search={search} onSearch={setSearch} hideSearch={location.pathname === '/map' || location.pathname.startsWith('/location/') || location.pathname.startsWith('/partner/')} />}
        <main className="app-content">
          <Routes>
            <Route path="/" element={<HomeRedirect><Locations search={search} onSearch={setSearch} /></HomeRedirect>} />
            <Route path="/map" element={<MapView />} />
            <Route path="/location/:id" element={<LocationDetail />} />
            <Route path="/book/:id" element={<CustomerRoute><BookingFlow /></CustomerRoute>} />
            <Route path="/book-advanced" element={<CustomerRoute><AdvancedBookingFlow /></CustomerRoute>} />
            <Route path="/orders" element={<CustomerRoute><MyOrders /></CustomerRoute>} />
            <Route path="/my-creatives" element={<CustomerRoute><MyCreatives /></CustomerRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/create-campaign" element={<CustomerRoute><CreateCampaign search={search} onSearch={setSearch} /></CustomerRoute>} />
            <Route path="/partner/dashboard" element={<PartnerRoute><PartnerDashboard /></PartnerRoute>} />
            <Route path="/partner/:id" element={<PartnerProfile />} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="/admin/spaces" element={<AdminRoute><AdminSpaces /></AdminRoute>} />
            <Route path="/admin/spaces/new" element={<AdminRoute><AdminSpaceEdit /></AdminRoute>} />
            <Route path="/admin/spaces/:id/edit" element={<AdminRoute><AdminSpaceEdit /></AdminRoute>} />
            <Route path="/admin/orders" element={<AdminRoute><AdminOrders /></AdminRoute>} />
            <Route path="/admin/calendar" element={<AdminRoute><AdminCalendar /></AdminRoute>} />
            <Route path="/admin/notifications" element={<AdminRoute><AdminNotifications /></AdminRoute>} />
            <Route path="/admin/translations" element={<AdminRoute><AdminTranslations /></AdminRoute>} />
            <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ModalProvider>
        <CampaignProvider>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </CampaignProvider>
      </ModalProvider>
    </AuthProvider>
  );
}

export default App;
