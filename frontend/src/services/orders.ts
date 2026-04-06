import api from './api';

export interface TimeRange {
  start_time: string;
  end_time: string;
}

export interface SelectedDay {
  date: string;
  time_ranges: TimeRange[];
}

export interface RecurringScheduleEntry {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface OrderCreateData {
  space_id: number;
  booking_type?: string;           // always "long_term"
  start_date: string;
  end_date: string;
  selected_days?: SelectedDay[];
  recurring_schedule?: RecurringScheduleEntry[];
  notes?: string;
  campaign_id?: number;
}

export interface TimeSlot {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

export interface OrderDetail {
  id: number;
  reference_number: string;
  space_id: number;
  booking_type: string;
  start_date: string;
  end_date: string;
  total_cost: number;
  status: string;
  notes?: string;
  created_at: string;
  campaign_id?: number;
  time_slots: TimeSlot[];
}

export interface ChildOrderItem {
  id: number;
  reference_number: string;
  space_id: number;
  space_name?: string;
  space_image?: string;
  booking_type: string;
  start_date: string;
  end_date: string;
  total_cost: number;
  status: string;
  created_at?: string;
  notes?: string;
  campaign_id?: number;
  time_slots?: TimeSlot[];
}

export interface OrderListItem {
  id: number;
  reference_number: string;
  space_id: number;
  booking_type: string;
  start_date: string;
  end_date: string;
  total_cost: number;
  status: string;
  notes?: string;
  created_at: string;
  space_name?: string;
  space_image?: string;
  campaign_id?: number;
  child_orders?: ChildOrderItem[];
  time_slots: TimeSlot[];
}

export interface Creative {
  id: number;
  file_url: string;
  file_type: string;
  approval_status: string;
  created_at: string;
}

export interface CompatibilitySlot {
  date: string;
  start_time: string;
  end_time: string;
}

export interface CompatibilityConflict {
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
}

export interface CompatibilityResult {
  compatibility: string;  // "full" | "partial" | "none"
  target_space_id: number;
  target_space_name: string;
  target_space_price_per_day: number;
  available_slots: CompatibilitySlot[];
  conflicts: CompatibilityConflict[];
  available_count: number;
  conflict_count: number;
  total_source_slots: number;
  estimated_cost: number;
}

export async function createOrder(data: OrderCreateData): Promise<OrderDetail> {
  const res = await api.post('/orders', data);
  return res.data;
}

export async function getMyOrders(): Promise<OrderListItem[]> {
  const res = await api.get('/orders/my', { params: { page: 1, page_size: 100 } });
  return res.data.items;
}

export async function getOrderDetail(id: number): Promise<OrderDetail> {
  const res = await api.get(`/orders/${id}`);
  return res.data;
}

export async function uploadCreative(
  orderId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Creative> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/orders/${orderId}/creatives`, formData, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
    },
  });
  return res.data;
}

export async function getCreatives(orderId: number): Promise<Creative[]> {
  const res = await api.get(`/orders/${orderId}/creatives`);
  return res.data;
}

export async function deleteCreative(orderId: number, creativeId: number): Promise<void> {
  await api.delete(`/orders/${orderId}/creatives/${creativeId}`);
}

export async function cancelOrder(id: number): Promise<OrderDetail> {
  const res = await api.put(`/orders/${id}/cancel`);
  return res.data;
}

export async function updateOrderNotes(id: number, notes: string): Promise<OrderDetail> {
  const res = await api.put(`/orders/${id}/notes`, { notes });
  return res.data;
}

export async function editOrder(id: number, data: Omit<OrderCreateData, 'space_id'>): Promise<OrderDetail> {
  const res = await api.put(`/orders/${id}/edit`, data);
  return res.data;
}

export interface OrderEvent {
  id: number;
  order_id: number;
  user_id: number | null;
  action_type: string;
  actor_type: string;
  description: string;
  created_at: string;
}

export async function getOrderTimeline(orderId: number): Promise<OrderEvent[]> {
  const res = await api.get(`/orders/${orderId}/timeline`);
  return res.data;
}

export interface CampaignCompatibilityTarget {
  target_space_id: number;
  exclude_order_id?: number;
}

export async function checkCompatibility(orderId: number, targetSpaceId: number, excludeOrderId?: number): Promise<CompatibilityResult> {
  const params: Record<string, any> = {};
  if (excludeOrderId != null) params.exclude_order = excludeOrderId;
  const res = await api.get(`/orders/${orderId}/compatibility/${targetSpaceId}`, { params });
  return res.data;
}

export async function checkCampaignCompatibility(orderId: number, targets: CampaignCompatibilityTarget[]): Promise<CompatibilityResult[]> {
  const res = await api.post(`/orders/${orderId}/campaign-compatibility`, targets);
  return res.data;
}

export async function duplicateCreatives(targetOrderId: number, sourceOrderId: number): Promise<void> {
  await api.post(`/orders/${targetOrderId}/duplicate-creatives-from/${sourceOrderId}`);
}

export interface ScheduleSlot {
  date: string;
  start_time: string;
  end_time: string;
}

export async function checkScheduleCompatibility(slots: ScheduleSlot[], targetSpaceId: number): Promise<CompatibilityResult> {
  const res = await api.post('/orders/check-schedule-compatibility', {
    target_space_id: targetSpaceId,
    slots,
  });
  return res.data;
}

// Campaign API
export interface CampaignCreateData {
  campaign_type: string;
  schedule_template?: { slots: ScheduleSlot[] };
}

export interface CampaignInfo {
  id: number;
  name: string;
  campaign_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  schedule_template?: { slots: ScheduleSlot[] } | null;
}

export async function createCampaign(data: CampaignCreateData): Promise<CampaignInfo> {
  const res = await api.post('/campaigns', data);
  return res.data;
}

export async function setOrderCampaign(orderId: number, campaignId: number): Promise<OrderDetail> {
  const res = await api.put(`/orders/${orderId}/set-campaign`, {
    campaign_id: campaignId,
  });
  return res.data;
}

export async function finalizeCampaign(campaignId: number): Promise<void> {
  await api.post(`/campaigns/${campaignId}/finalize`);
}

export async function cancelCampaign(campaignId: number): Promise<CampaignInfo> {
  const res = await api.put(`/campaigns/${campaignId}/cancel`);
  return res.data;
}

export async function deleteCampaign(campaignId: number): Promise<void> {
  await api.delete(`/campaigns/${campaignId}`);
}

export async function getCampaignDetail(campaignId: number): Promise<CampaignInfo & { orders: OrderListItem[] }> {
  const res = await api.get(`/campaigns/${campaignId}`);
  return res.data;
}
