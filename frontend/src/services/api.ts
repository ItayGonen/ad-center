import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.56.1:8000';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  config.headers['Accept-Language'] = localStorage.getItem('language') || 'en';
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/')) {
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export async function getPublicSettings(): Promise<{ accent_color: string }> {
  const res = await api.get('/settings/public');
  return res.data;
}

export default api;
