import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSpaces } from '../services/spaces';
import type { SpaceListItem } from '../services/spaces';
import Loader from '../components/Loader';
import { deleteAdminSpace } from '../services/admin';
import { useModal } from '../context/ModalContext';
import { API_URL } from '../services/api';

export default function AdminSpaces() {
  const { t } = useTranslation('admin');
  const modal = useModal();
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { loadSpaces(); }, []);

  async function loadSpaces() {
    try {
      setSpaces(await getSpaces());
    } catch {
      setError(t('failedLoadSpaces'));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!await modal.confirm({ title: t('deleteSpace'), message: t('deleteSpaceConfirm'), variant: 'danger' })) return;
    try {
      await deleteAdminSpace(id);
      setSpaces(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      await modal.alert({ title: t('error', { ns: 'common' }), message: err.response?.data?.detail || t('delete', { ns: 'common' }) });
    }
  }

  const filtered = spaces.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q)
      || (s.city || '').toLowerCase().includes(q)
      || (s.space_type?.name || '').toLowerCase().includes(q)
      || (s.partner_name || '').toLowerCase().includes(q);
  });

  if (loading) return <Loader variant="page" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab active">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab">{t('settings')}</Link>
      </div>

      <div className="admin-header">
        <div className="admin-header-left">
          <h1>{t('manageSpaces')}</h1>
          <span className="admin-header-count">{t('total', { count: spaces.length })}</span>
        </div>
        <div className="admin-header-right">
          <div className="admin-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder={t('searchSpaces')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="admin-search-clear" onClick={() => setSearch('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <Link to="/admin/spaces/new" className="btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('newSpace')}
          </Link>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {filtered.length === 0 ? (
        <div className="admin-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="48" height="48"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <p>{search ? t('noSpacesMatchSearch') : t('noSpacesYet')}</p>
          {!search && <Link to="/admin/spaces/new" className="btn-primary">{t('createFirstSpace')}</Link>}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('space')}</th>
                <th>{t('type')}</th>
                <th>{t('environment')}</th>
                <th>{t('impressions')}</th>
                <th>{t('pricePerDay')}</th>
                <th>{t('partner')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(space => (
                <tr key={space.id}>
                  <td>
                    <Link to={`/admin/spaces/${space.id}/edit`} className="admin-space-cell">
                      <div className="admin-table-thumb">
                        {space.first_image ? (
                          <img src={`${API_URL}${space.first_image}`} alt="" />
                        ) : (
                          <span className="admin-table-thumb-empty">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                          </span>
                        )}
                      </div>
                      <div className="admin-space-info">
                        <span className="admin-space-name">{space.name}</span>
                        <span className="admin-space-location">{space.city || t('city')}</span>
                      </div>
                    </Link>
                  </td>
                  <td>
                    {space.space_type ? (
                      <span className="admin-type-pill">{space.space_type.name}</span>
                    ) : '—'}
                  </td>
                  <td>
                    {space.environment ? (
                      <span className={`admin-env-pill env-${space.environment}`}>{space.environment}</span>
                    ) : '—'}
                  </td>
                  <td>{space.estimated_daily_impressions || '—'}</td>
                  <td className="admin-price-cell">&#8362;{space.price_per_day}</td>
                  <td>{space.partner_name || '—'}</td>
                  <td className="action-cell">
                    <Link to={`/admin/spaces/${space.id}/edit`} className="btn-edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      {t('edit', { ns: 'common' })}
                    </Link>
                    <button onClick={() => handleDelete(space.id)} className="btn-danger">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                      {t('delete', { ns: 'common' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
