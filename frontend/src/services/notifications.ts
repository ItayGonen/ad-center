import api from './api';

export interface Notification {
  id: number;
  type: string;
  title?: string;
  message: string;
  link?: string;
  related_order_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  items: Notification[];
  unread_count: number;
}

export async function getNotifications(): Promise<NotificationsResponse> {
  const res = await api.get('/notifications');
  return res.data;
}

export async function markAsRead(id: number): Promise<void> {
  await api.put(`/notifications/${id}/read`);
}

export async function markAllAsRead(): Promise<void> {
  await api.put('/notifications/read-all');
}

export async function clearAllNotifications(): Promise<void> {
  await api.delete('/notifications/clear-all');
}
