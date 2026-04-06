import api from './api';

export interface NotificationPreferences {
  email_notifications: boolean;
  notify_order_created: boolean;
  notify_order_confirmed: boolean;
  notify_order_cancelled: boolean;
  notify_order_completed: boolean;
}

export interface User {
  id: number;
  email: string;
  name: string;
  phone_number?: string;
  company_name?: string;
  profile_picture?: string;
  notification_preferences?: NotificationPreferences;
  language: string;
  role: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
  is_new?: boolean;
  google_picture_url?: string;
}

export async function register(data: { email: string; password: string; name: string; phone_number?: string; company_name?: string; language?: string }): Promise<TokenResponse> {
  const res = await api.post('/auth/register', data);
  return res.data;
}

export async function login(data: { email: string; password: string }): Promise<TokenResponse> {
  const res = await api.post('/auth/login', data);
  return res.data;
}

export async function getMe(): Promise<User> {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function googleLogin(credential: string): Promise<TokenResponse> {
  const res = await api.post('/auth/google', { credential });
  return res.data;
}

export async function updateProfile(data: { name?: string; email?: string; phone_number?: string; company_name?: string; language?: string }): Promise<User> {
  const res = await api.put('/auth/me', data);
  return res.data;
}

export async function changePassword(data: { current_password: string; new_password: string }): Promise<{ message: string }> {
  const res = await api.put('/auth/me/password', data);
  return res.data;
}

export async function uploadAvatar(file: File): Promise<User> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/auth/me/avatar', formData);
  return res.data;
}

export async function deleteAvatar(): Promise<User> {
  const res = await api.delete('/auth/me/avatar');
  return res.data;
}

export async function saveGoogleAvatar(url: string): Promise<User> {
  const res = await api.post('/auth/me/avatar/from-url', { url });
  return res.data;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await api.get('/auth/me/notification-preferences');
  return res.data;
}

export async function updateNotificationPreferences(data: NotificationPreferences): Promise<NotificationPreferences> {
  const res = await api.put('/auth/me/notification-preferences', data);
  return res.data;
}

export async function logoutApi(): Promise<void> {
  await api.post('/auth/logout');
}
