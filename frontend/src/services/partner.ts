import api from './api';

export interface PartnerOrder {
  id: number;
  reference_number: string;
  user_name: string;
  user_email: string;
  space_id: number;
  space_name: string;
  space_image?: string;
  start_date: string;
  end_date: string;
  total_cost: number;
  status: string;
  created_at: string;
}

export interface PartnerDashboard {
  total_spaces: number;
  total_orders: number;
  total_revenue: number;
  partner_revenue: number;
  pending_orders: number;
  confirmed_orders: number;
  recent_orders: PartnerOrder[];
}

export interface PartnerSpaceItem {
  id: number;
  name: string;
  city?: string;
  price_per_day: number;
  first_image?: string;
  estimated_daily_impressions?: string | null;
  space_type?: { id: number; name: string } | null;
  lat?: number | null;
  lng?: number | null;
}

export interface MonthlyRevenue {
  month: string;
  revenue: number;
  partner_share: number;
}

export interface DailyRevenue {
  day: string;
  revenue: number;
  partner_share: number;
}

export interface PartnerRevenue {
  total_revenue: number;
  partner_total: number;
  monthly_revenue: MonthlyRevenue[];
  daily_revenue: DailyRevenue[];
}

export interface PartnerProfile {
  id: number;
  name: string;
  company_name?: string;
  profile_picture?: string;
  spaces: PartnerSpaceItem[];
}

export async function getPartnerDashboard(): Promise<PartnerDashboard> {
  const res = await api.get('/partner/dashboard');
  return res.data;
}

export async function getPartnerSpaces(lang = 'en'): Promise<PartnerSpaceItem[]> {
  const res = await api.get('/partner/spaces', { params: { page: 1, page_size: 100, lang } });
  return res.data.items;
}

export async function getPartnerOrders(): Promise<PartnerOrder[]> {
  const res = await api.get('/partner/orders', { params: { page: 1, page_size: 100 } });
  return res.data.items;
}

export async function getPartnerRevenue(): Promise<PartnerRevenue> {
  const res = await api.get('/partner/revenue');
  return res.data;
}

export interface PartnerOccupancy {
  occupancy_rate: number;
  booked_hours: number;
  available_hours: number;
  period: string;
}

export async function getPartnerOccupancy(period: 'week' | 'month' | 'year'): Promise<PartnerOccupancy> {
  const res = await api.get('/partner/occupancy', { params: { period } });
  return res.data;
}

export async function getPartnerProfile(partnerId: number): Promise<PartnerProfile> {
  const res = await api.get(`/spaces/partner/${partnerId}`);
  return res.data;
}
