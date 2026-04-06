import api from './api';

export interface SpaceTypeItem {
  id: number;
  name: string;
}

export interface AudienceProfile {
  id: number;
  name: string;
  category: string;
}

export interface SpaceListItem {
  id: number;
  name: string;
  city?: string;
  estimated_daily_impressions?: string;
  space_type?: SpaceTypeItem;
  audience_profiles?: AudienceProfile[];
  environment?: string;
  price_per_day: number;
  first_image?: string;
  partner_owner?: number;
  partner_name?: string;
  average_dwell_time?: number;
  number_of_screens?: number;
  screen_size?: string;
  resolution?: string;
  general_description?: string;
  full_address?: string;
}

export interface OperatingHours {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Screen {
  id: number;
  name?: string;
  size_inches: string;
  resolution_width: number;
  resolution_height: number;
  position_description?: string;
  is_active: boolean;
  created_at: string;
}

export interface SpaceImage {
  id: number;
  image_url: string;
  created_at: string;
}

export interface SpaceDetail {
  id: number;
  name: string;
  general_description?: string;
  city?: string;
  full_address?: string;
  lat?: number;
  lng?: number;
  estimated_daily_impressions?: string;
  space_type?: SpaceTypeItem;
  audience_profiles?: AudienceProfile[];
  environment?: string;
  price_per_day: number;
  images: SpaceImage[];
  operating_hours: OperatingHours[];
  screens: Screen[];
  created_at: string;
  partner_owner?: number;
  partner_name?: string;
  partner_profile_picture?: string;
  average_dwell_time?: number;
  number_of_screens?: number;
  screen_size?: string;
  resolution?: string;
}

export interface TimeWindow {
  start_time: string;
  end_time: string;
}

export interface HourSlotInfo {
  hour: string;        // "09:00"
  booked_count: number; // 0–6
  max_slots: number;    // 6
}

export interface DayAvailability {
  date: string;
  day_of_week: number;
  available_windows: TimeWindow[];
  operating_hours?: TimeWindow;
  hour_slots?: HourSlotInfo[];
}

function currentLang(): string {
  return localStorage.getItem('language') || 'en';
}

export async function getSpaces(): Promise<SpaceListItem[]> {
  const res = await api.get('/spaces', { params: { page: 1, page_size: 100, lang: currentLang() } });
  return res.data.items;
}

export async function getSpaceDetail(id: number, lang?: string): Promise<SpaceDetail> {
  const res = await api.get(`/spaces/${id}`, { params: { lang: lang ?? currentLang() } });
  return res.data;
}

export async function getSpaceTypes(): Promise<SpaceTypeItem[]> {
  const res = await api.get('/spaces/space-types');
  return res.data;
}

export async function getAudienceProfiles(lang = 'en'): Promise<AudienceProfile[]> {
  const res = await api.get('/spaces/audience-profiles', { params: { lang } });
  return res.data;
}

export async function getAvailability(id: number, startDate: string, endDate: string, excludeOrder?: number): Promise<DayAvailability[]> {
  const params: Record<string, string | number> = { start_date: startDate, end_date: endDate };
  if (excludeOrder) params.exclude_order = excludeOrder;
  const res = await api.get(`/spaces/${id}/availability`, { params });
  return res.data;
}
