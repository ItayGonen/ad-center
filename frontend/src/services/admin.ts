import api from './api';
import type { User } from './auth';
import type { SpaceDetail, SpaceImage, OperatingHours, SpaceTypeItem, AudienceProfile, Screen } from './spaces';

export interface AdminOrderTimeSlot {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

export interface AdminOrderCreative {
  id: number;
  file_url: string;
  file_type: string;
  approval_status: string;
  created_at: string;
}

export interface AdminOrder {
  id: number;
  reference_number: string;
  user_id: number;
  user_name: string;
  user_email: string;
  space_id: number;
  space_name?: string;
  start_date: string;
  end_date: string;
  total_cost: number;
  status: string;
  notes?: string;
  payment_proof_url?: string;
  created_at: string;
  time_slots: AdminOrderTimeSlot[];
  creatives: AdminOrderCreative[];
  campaign_id?: number;
}

export interface PartnerOption {
  id: number;
  name: string;
  email: string;
}

export async function getPartners(): Promise<PartnerOption[]> {
  const res = await api.get('/admin/partners');
  return res.data;
}

export interface AdminUserCreateData {
  name: string;
  email: string;
  password: string;
  role: string;
  phone_number?: string;
  company_name?: string;
}

export async function createAdminUser(data: AdminUserCreateData): Promise<User> {
  const res = await api.post('/admin/users', data);
  return res.data;
}

export async function uploadUserAvatar(userId: number, file: File): Promise<User> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/admin/users/${userId}/avatar`, formData);
  return res.data;
}

export async function getAdminUsers(): Promise<User[]> {
  const res = await api.get('/admin/users', { params: { page: 1, page_size: 100 } });
  return res.data.items;
}

export async function updateAdminUser(id: number, data: { name?: string; email?: string; role?: string; phone_number?: string; company_name?: string; password?: string }): Promise<User> {
  const res = await api.put(`/admin/users/${id}`, data);
  return res.data;
}

export async function deleteAdminUser(id: number): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}

export type SpaceTranslations = Record<string, Record<string, string>>;

export async function getSpaceTranslations(spaceId: number): Promise<SpaceTranslations> {
  const res = await api.get(`/admin/spaces/${spaceId}/translations`);
  return res.data;
}

export async function createAdminSpace(data: Record<string, unknown>): Promise<SpaceDetail> {
  const res = await api.post('/admin/spaces', data);
  return res.data;
}

export async function updateAdminSpace(id: number, data: Record<string, unknown>): Promise<SpaceDetail> {
  const res = await api.put(`/admin/spaces/${id}`, data);
  return res.data;
}

export async function deleteAdminSpace(id: number): Promise<void> {
  await api.delete(`/admin/spaces/${id}`);
}

// Space Type & Audience Profile CRUD + translations
export type ItemTranslations = Record<number, Record<string, string>>; // {id: {lang: value}}

export async function createSpaceType(name: string, nameHe: string): Promise<SpaceTypeItem> {
  const res = await api.post('/admin/space-types', { name, name_he: nameHe });
  return res.data;
}

export async function deleteSpaceType(id: number): Promise<void> {
  await api.delete(`/admin/space-types/${id}`);
}

export async function createAudienceProfile(name: string, nameHe: string, category: string): Promise<AudienceProfile> {
  const res = await api.post('/admin/audience-profiles', { name, name_he: nameHe, category });
  return res.data;
}

export async function deleteAudienceProfile(id: number): Promise<void> {
  await api.delete(`/admin/audience-profiles/${id}`);
}

export async function getSpaceTypeTranslations(): Promise<ItemTranslations> {
  const res = await api.get('/admin/space-types/translations');
  return res.data;
}

export async function setSpaceTypeTranslations(translations: ItemTranslations): Promise<void> {
  await api.put('/admin/space-types/translations', { translations });
}

export async function getAudienceProfileTranslations(): Promise<ItemTranslations> {
  const res = await api.get('/admin/audience-profiles/translations');
  return res.data;
}

export async function setAudienceProfileTranslations(translations: ItemTranslations): Promise<void> {
  await api.put('/admin/audience-profiles/translations', { translations });
}

export async function uploadSpaceImage(spaceId: number, file: File): Promise<SpaceImage> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/admin/spaces/${spaceId}/images`, formData);
  return res.data;
}

export async function deleteSpaceImage(imageId: number): Promise<void> {
  await api.delete(`/admin/spaces/images/${imageId}`);
}

export async function getAdminOrders(): Promise<AdminOrder[]> {
  const res = await api.get('/admin/orders', { params: { page: 1, page_size: 100 } });
  return res.data.items;
}

export async function updateAdminOrderStatus(id: number, status: string): Promise<AdminOrder> {
  const res = await api.put(`/admin/orders/${id}`, { status });
  return res.data;
}

export async function deleteAdminOrder(id: number): Promise<void> {
  await api.delete(`/admin/orders/${id}`);
}

export async function confirmOrderWithProof(orderId: number, file: File): Promise<AdminOrder> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.put(`/admin/orders/${orderId}/confirm-with-proof`, formData);
  return res.data;
}

export async function approveCampaign(campaignId: number): Promise<{ campaign_id: number; approved_count: number }> {
  const res = await api.put(`/admin/campaigns/${campaignId}/approve`);
  return res.data;
}

export async function approveCampaignWithProof(campaignId: number, file: File): Promise<{ campaign_id: number; confirmed_count: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.put(`/admin/campaigns/${campaignId}/approve-with-proof`, formData);
  return res.data;
}

export async function deleteAdminCampaign(campaignId: number): Promise<void> {
  await api.delete(`/admin/campaigns/${campaignId}`);
}

export async function addOperatingHours(spaceId: number, data: { day_of_week: number; start_time: string; end_time: string }): Promise<OperatingHours> {
  const res = await api.post(`/admin/spaces/${spaceId}/operating-hours`, data);
  return res.data;
}

export async function deleteOperatingHours(ohId: number): Promise<void> {
  await api.delete(`/admin/spaces/operating-hours/${ohId}`);
}

// Screen translations: { screen_id: { lang: { field: value } } }
export type ScreenTranslations = Record<number, Record<string, Record<string, string>>>;

export async function getScreenTranslations(spaceId: number): Promise<ScreenTranslations> {
  const res = await api.get(`/admin/spaces/${spaceId}/screen-translations`);
  return res.data;
}

export async function setScreenTranslations(translations: ScreenTranslations): Promise<void> {
  await api.put('/admin/spaces/screen-translations', { translations });
}

export async function addScreen(spaceId: number, data: { name?: string; size_inches: string; resolution_width: number; resolution_height: number; position_description?: string; is_active?: boolean }): Promise<Screen> {
  const res = await api.post(`/admin/spaces/${spaceId}/screens`, data);
  return res.data;
}

export async function updateScreen(screenId: number, data: { name?: string; size_inches?: string; resolution_width?: number; resolution_height?: number; position_description?: string; is_active?: boolean }): Promise<Screen> {
  const res = await api.put(`/admin/spaces/screens/${screenId}`, data);
  return res.data;
}

export async function deleteScreen(screenId: number): Promise<void> {
  await api.delete(`/admin/spaces/screens/${screenId}`);
}

export async function sendBroadcastNotification(data: {
  title: string;
  message: string;
  notification_type: string;
}): Promise<{ sent: number; total: number }> {
  const res = await api.post('/admin/broadcast-notification', data);
  return res.data;
}

// ── Calendar ──────────────────────────────────────────

export interface CalendarSlotOrder {
  order_id: number;
  reference_number: string;
  user_id: number;
  user_name: string;
  user_email: string;
  space_id: number;
  space_name: string;
  booking_type: string;
  campaign_id?: number;
  status: string;
  total_cost: number;
  slot_position: number;
}

export interface CalendarHourSlot {
  space_id: number;
  space_name: string;
  hour: string;
  booked_count: number;
  max_slots: number;
  orders: CalendarSlotOrder[];
}

export interface CalendarDayEntry {
  date: string;
  day_of_week: number;
  hours: CalendarHourSlot[];
}

export interface CalendarSpaceSummary {
  id: number;
  name: string;
}

export interface AdminCalendarResponse {
  days: CalendarDayEntry[];
  spaces: CalendarSpaceSummary[];
}

export async function getAdminCalendar(startDate: string, endDate: string): Promise<AdminCalendarResponse> {
  const res = await api.get('/admin/calendar', { params: { start_date: startDate, end_date: endDate } });
  return res.data;
}

// ── Settings ──────────────────────────────────────────

export interface AdminSettings {
  emails_enabled: boolean;
  accent_color: string;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await api.get('/admin/settings');
  return res.data;
}

export async function updateEmailSetting(enabled: boolean): Promise<AdminSettings> {
  const res = await api.put('/admin/settings/emails', { enabled });
  return res.data;
}

export async function updateAccentColor(color: string): Promise<{ accent_color: string }> {
  const res = await api.put('/admin/settings/accent-color', { color });
  return res.data;
}
