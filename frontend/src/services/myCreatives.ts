import api from './api';

export interface UserCreative {
  id: number;
  original_filename: string;
  file_url: string;
  thumbnail_url: string | null;
  file_type: 'image' | 'video';
  mime_type: string | null;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  original_url: string | null;
  processed_url: string | null;
  processing_status: 'uploading' | 'processing' | 'ready' | 'failed';
  processing_step: string | null;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorTransformRequest {
  rotation?: number;
  crop?: CropRect;
}

export interface UserCreativeListResponse {
  items: UserCreative[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ValidationIssue {
  type: 'warning' | 'error';
  code: string;
  message: string;
}

export interface CampaignValidationResponse {
  valid: boolean;
  issues: ValidationIssue[];
}

export async function uploadCreativeToVault(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UserCreative> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/my-creatives/', formData, {
    timeout: 120000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
    },
  });
  return res.data;
}

export async function getMyCreatives(
  page = 1,
  pageSize = 20,
  fileType?: string,
): Promise<UserCreativeListResponse> {
  const params: Record<string, any> = { page, page_size: pageSize };
  if (fileType) params.file_type = fileType;
  const res = await api.get('/my-creatives/', { params });
  return res.data;
}

export async function getCreativeDetail(id: number): Promise<UserCreative> {
  const res = await api.get(`/my-creatives/${id}`);
  return res.data;
}

export async function deleteCreativeFromVault(id: number): Promise<void> {
  await api.delete(`/my-creatives/${id}`);
}

export async function applyEditorTransform(
  creativeId: number,
  transform: EditorTransformRequest,
): Promise<UserCreative> {
  const res = await api.post(`/my-creatives/${creativeId}/edit`, transform);
  return res.data;
}

export async function validateCreativeForCampaign(
  creativeId: number,
  spaceId: number,
): Promise<CampaignValidationResponse> {
  const res = await api.post('/my-creatives/validate-for-campaign', {
    creative_id: creativeId,
    space_id: spaceId,
  });
  return res.data;
}
