import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdminOrders, updateAdminOrderStatus, deleteAdminOrder, deleteAdminCampaign, approveCampaignWithProof } from '../services/admin';
import type { AdminOrder, AdminOrderTimeSlot } from '../services/admin';
import { useModal } from '../context/ModalContext';
import PaymentProofModal from '../components/PaymentProofModal';
import CampaignProofModal from '../components/CampaignProofModal';
import Loader from '../components/Loader';
import { API_URL } from '../services/api';

const ORDER_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

interface CampaignGroup {
  campaignId: number;
  orders: AdminOrder[];
  pendingCount: number;
  totalCost: number;
}

export default function AdminOrders() {
  const { t } = useTranslation('admin');
  const modal = useModal();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set());
  const [slotsModal, setSlotsModal] = useState<{ order: AdminOrder } | null>(null);
  const [confirmModal, setConfirmModal] = useState<AdminOrder | null>(null);
  const [campaignProofModal, setCampaignProofModal] = useState<CampaignGroup | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    try {
      setOrders(await getAdminOrders());
    } catch {
      setError(t('failedLoadOrders'));
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(order: AdminOrder, newStatus: string) {
    if (newStatus === 'confirmed') {
      setConfirmModal(order);
      return;
    }
    try {
      const updated = await updateAdminOrderStatus(order.id, newStatus);
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch {
      await modal.alert({ title: t('error', { ns: 'common' }), message: t('failedUpdateStatus') });
    }
  }

  async function handleDelete(id: number) {
    if (!await modal.confirm({ title: t('Delete Order'), message: t('deleteOrderConfirm'), variant: 'danger' })) return;
    try {
      await deleteAdminOrder(id);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (err: any) {
      await modal.alert({ title: t('error', { ns: 'common' }), message: err.response?.data?.detail || t('failedLoadOrders') });
    }
  }

  function handleApproveCampaign(group: CampaignGroup) {
    setCampaignProofModal(group);
  }

  async function handleDeleteCampaign(group: CampaignGroup) {
    if (!await modal.confirm({
      title: t('deleteCampaign'),
      message: t('deleteCampaignConfirm', { id: group.campaignId, count: group.orders.length }),
      variant: 'danger',
    })) return;
    try {
      await deleteAdminCampaign(group.campaignId);
      // Remove all orders belonging to this campaign from local state
      const campaignOrderIds = new Set(group.orders.map(o => o.id));
      setOrders(prev => prev.filter(o => !campaignOrderIds.has(o.id)));
    } catch (err: any) {
      await modal.alert({ title: t('error', { ns: 'common' }), message: err.response?.data?.detail || t('failedDeleteCampaign') });
    }
  }

  function toggleCampaign(id: number) {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group orders into campaigns and standalone
  const { campaignGroups, standaloneOrders } = useMemo(() => {
    const campMap = new Map<number, AdminOrder[]>();
    const standalone: AdminOrder[] = [];

    for (const order of orders) {
      if (order.campaign_id) {
        const list = campMap.get(order.campaign_id) || [];
        list.push(order);
        campMap.set(order.campaign_id, list);
      } else {
        standalone.push(order);
      }
    }

    const groups: CampaignGroup[] = Array.from(campMap.entries()).map(([campaignId, campaignOrders]) => ({
      campaignId,
      orders: campaignOrders,
      pendingCount: campaignOrders.filter(o => o.status === 'pending').length,
      totalCost: campaignOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_cost, 0),
    }));

    // Sort campaigns: those with pending first, then by id desc
    groups.sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
      return b.campaignId - a.campaignId;
    });

    return { campaignGroups: groups, standaloneOrders: standalone };
  }, [orders]);

  // Group time slots by date for compact modal display
  function groupSlotsByDate(slots: AdminOrderTimeSlot[]): Map<string, AdminOrderTimeSlot[]> {
    const map = new Map<string, AdminOrderTimeSlot[]>();
    for (const slot of slots) {
      const list = map.get(slot.date) || [];
      list.push(slot);
      map.set(slot.date, list);
    }
    return map;
  }

  function renderStatusCounts(campaignOrders: AdminOrder[]) {
    const counts: Record<string, number> = {};
    for (const o of campaignOrders) {
      counts[o.status] = (counts[o.status] || 0) + 1;
    }
    return (
      <div className="ao-campaign-statuses">
        {Object.entries(counts).map(([status, count]) => (
          <span key={status} className={`ao-mini-pill status-${status}`}>
            {count} {t(status, { ns: 'common' })}
          </span>
        ))}
      </div>
    );
  }

  function renderOrderRow(order: AdminOrder) {
    const slotCount = order.time_slots?.length || 0;

    return (
      <tr key={order.id} className="ao-order-row">
        <td className="ao-cell-id">{order.id}</td>
        <td className="ao-cell-ref">{order.reference_number}</td>
        <td>
          <div className="ao-user-info">
            <span className="ao-user-name">{order.user_name}</span>
            <span className="ao-user-email">{order.user_email}</span>
          </div>
        </td>
        <td>{order.space_name || `#${order.space_id}`}</td>
        <td className="ao-cell-dates">{order.start_date} — {order.end_date}</td>
        <td>
          {slotCount > 0 ? (
            <button
              className="ao-slots-trigger"
              onClick={() => setSlotsModal({ order })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {slotCount} {t('slotsCount')}
            </button>
          ) : (
            <span className="ao-no-data">{t('noCampaign')}</span>
          )}
        </td>
        <td className="ao-cell-cost">&#8362;{order.total_cost.toLocaleString()}</td>
        <td>
          {order.creatives && order.creatives.length > 0 ? (
            <div className="admin-creatives">
              {order.creatives.map(c => (
                <div key={c.id} className="admin-creative" onClick={() => window.open(`${API_URL}${c.file_url}`, '_blank')}>
                  {c.file_type === 'image' ? (
                    <img src={`${API_URL}${c.file_url}`} alt="" />
                  ) : (
                    <span className="admin-creative-type">{c.file_type.toUpperCase()}</span>
                  )}
                </div>
              ))}
            </div>
          ) : <span className="ao-no-data">{t('noCampaign')}</span>}
        </td>
        <td>
          <div className={`admin-status-pill status-${order.status}`}>
            <span className="admin-status-dot" />
            <select
              value={order.status}
              onChange={e => handleStatusChange(order, e.target.value)}
              className="admin-status-select"
            >
              {ORDER_STATUSES.map(s => (
                <option key={s} value={s}>{t(s, { ns: 'common' })}</option>
              ))}
            </select>
          </div>
        </td>
        <td>
          {order.payment_proof_url ? (
            <div
              className="ao-proof-cell"
              onClick={() => window.open(`${API_URL}${order.payment_proof_url}`, '_blank')}
            >
              <img src={`${API_URL}${order.payment_proof_url}`} alt="" />
            </div>
          ) : (
            <span className="ao-no-data">—</span>
          )}
        </td>
        <td className="ao-cell-created">{new Date(order.created_at).toLocaleDateString()}</td>
        <td>
          <button onClick={() => handleDelete(order.id)} className="btn-danger">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            {t('delete', { ns: 'common' })}
          </button>
        </td>
      </tr>
    );
  }

  function renderOrdersTable(tableOrders: AdminOrder[]) {
    return (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('id')}</th>
              <th>{t('reference')}</th>
              <th>{t('user')}</th>
              <th>{t('name')}</th>
              <th>{t('dates')}</th>
              <th>{t('bookedSlots')}</th>
              <th>{t('cost')}</th>
              <th>{t('media')}</th>
              <th>{t('status')}</th>
              <th>{t('paymentProof')}</th>
              <th>{t('created')}</th>
              <th>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {tableOrders.map(order => renderOrderRow(order))}
          </tbody>
        </table>
      </div>
    );
  }

  if (loading) return <Loader variant="page" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab active">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab">{t('settings')}</Link>
      </div>

      <h1>{t('manageOrders')}</h1>
      {error && <div className="error-msg">{error}</div>}

      {/* Campaign groups */}
      {campaignGroups.length > 0 && (
        <div className="ao-section">
          <div className="ao-section-header">
            <h2 className="ao-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              {t('campaignOrders')}
            </h2>
            <span className="ao-section-count">{campaignGroups.length} {t('campaign').toLowerCase()}(s)</span>
          </div>

          <div className="ao-campaigns-list">
            {campaignGroups.map(group => {
              const isExpanded = expandedCampaigns.has(group.campaignId);
              return (
                <div key={group.campaignId} className={`ao-campaign-card ${group.pendingCount > 0 ? 'has-pending' : ''}`}>
                  <div className="ao-campaign-header" onClick={() => toggleCampaign(group.campaignId)}>
                    <div className="ao-campaign-left">
                      <svg
                        className={`ao-chevron ${isExpanded ? 'expanded' : ''}`}
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span className="ao-campaign-badge">C-{group.campaignId}</span>
                      <span className="ao-campaign-name">{t('campaignLabel', { id: group.campaignId })}</span>
                      {(() => {
                        const proofUrl = group.orders.find(o => o.payment_proof_url)?.payment_proof_url;
                        if (!proofUrl) return null;
                        return (
                          <div
                            className="ao-proof-thumb"
                            onClick={e => { e.stopPropagation(); window.open(`${API_URL}${proofUrl}`, '_blank'); }}
                            title={t('paymentProof')}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                            <img src={`${API_URL}${proofUrl}`} alt="" />
                          </div>
                        );
                      })()}
                    </div>
                    <div className="ao-campaign-meta">
                      {renderStatusCounts(group.orders)}
                      <span className="ao-campaign-orders-count">
                        {group.orders.length} {t('orders').toLowerCase()}
                      </span>
                      <span className="ao-campaign-total">&#8362;{group.totalCost.toLocaleString()}</span>
                      {group.pendingCount > 0 && (
                        <button
                          className="ao-approve-btn"
                          onClick={e => { e.stopPropagation(); handleApproveCampaign(group); }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          {t('approveAllPending')}
                        </button>
                      )}
                      <button
                        className="ao-delete-campaign-btn"
                        onClick={e => { e.stopPropagation(); handleDeleteCampaign(group); }}
                        title={t('deleteCampaign')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="ao-campaign-body">
                      {renderOrdersTable(group.orders)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Standalone orders (no campaign) */}
      {standaloneOrders.length > 0 && (
        <div className="ao-section">
          <div className="ao-section-header">
            <h2 className="ao-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {t('standaloneOrders')}
            </h2>
            <span className="ao-section-count">{standaloneOrders.length} {t('orders').toLowerCase()}</span>
          </div>
          {renderOrdersTable(standaloneOrders)}
        </div>
      )}

      {orders.length === 0 && !error && (
        <div className="ao-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <p>{t('noOrders')}</p>
        </div>
      )}

      {/* Payment Proof Modal */}
      {confirmModal && (
        <PaymentProofModal
          order={confirmModal}
          onClose={() => setConfirmModal(null)}
          onConfirmed={(updated) => {
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            setConfirmModal(null);
          }}
        />
      )}

      {/* Campaign Proof Modal */}
      {campaignProofModal && (
        <CampaignProofModal
          campaignId={campaignProofModal.campaignId}
          orderCount={campaignProofModal.pendingCount}
          totalCost={campaignProofModal.totalCost}
          onClose={() => setCampaignProofModal(null)}
          onConfirmed={async () => {
            setCampaignProofModal(null);
            setLoading(true);
            await loadOrders();
          }}
        />
      )}

      {/* Time Slots Modal */}
      {slotsModal && (
        <div className="ao-modal-overlay" onClick={() => setSlotsModal(null)}>
          <div className="ao-modal" onClick={e => e.stopPropagation()}>
            <div className="ao-modal-header">
              <div>
                <h3 className="ao-modal-title">{t('bookedSlots')}</h3>
                <p className="ao-modal-subtitle">
                  {t('orderRef')}: {slotsModal.order.reference_number} &middot; {slotsModal.order.space_name || `#${slotsModal.order.space_id}`}
                </p>
              </div>
              <button className="ao-modal-close" onClick={() => setSlotsModal(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="ao-modal-body">
              <div className="ao-slots-summary">
                <span className="ao-slots-total-badge">
                  {slotsModal.order.time_slots.length} {t('slotsCount')}
                </span>
                <span className="ao-slots-date-range">
                  {slotsModal.order.start_date} — {slotsModal.order.end_date}
                </span>
              </div>
              <div className="ao-slots-grid">
                {Array.from(groupSlotsByDate(slotsModal.order.time_slots).entries()).map(([date, daySlots]) => (
                  <div key={date} className="ao-slots-day">
                    <div className="ao-slots-day-header">{date}</div>
                    <div className="ao-slots-day-times">
                      {daySlots.map(slot => (
                        <span key={slot.id} className={`ao-slot-chip ${slot.status === 'booked' ? 'booked' : ''}`}>
                          {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
