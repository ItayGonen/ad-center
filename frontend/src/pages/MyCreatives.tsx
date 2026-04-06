import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyCreatives, uploadCreativeToVault, deleteCreativeFromVault } from '../services/myCreatives';
import type { UserCreative } from '../services/myCreatives';
import { API_URL } from '../services/api';
import VideoThumbnail from '../components/VideoThumbnail';
import ProcessingOverlay from '../components/ProcessingOverlay';
import AppModal from '../components/AppModal';
import LeadsEditor from '../components/LeadsEditor';
import './MyCreatives.css';

type FilterType = 'all' | 'image' | 'video';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MyCreatives() {
  const { t } = useTranslation('creatives');
  const [creatives, setCreatives] = useState<UserCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [deleteTarget, setDeleteTarget] = useState<UserCreative | null>(null);
  const [editTarget, setEditTarget] = useState<UserCreative | null>(null);
  const [isMandatoryEdit, setIsMandatoryEdit] = useState(false);

  // Upload / processing overlay state
  const [uploadingCreative, setUploadingCreative] = useState<UserCreative | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fetchCreatives = useCallback(() => {
    const fileType = filter === 'all' ? undefined : filter;
    getMyCreatives(1, 100, fileType)
      .then(res => setCreatives(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchCreatives();
  }, [fetchCreatives]);

  // Poll for processing items
  useEffect(() => {
    const hasProcessing = creatives.some(c => c.processing_status === 'processing' || c.processing_status === 'uploading');
    if (!hasProcessing) return;
    const interval = setInterval(fetchCreatives, 4000);
    return () => clearInterval(interval);
  }, [creatives, fetchCreatives]);

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      setUploadProgress(0);
      try {
        const creative = await uploadCreativeToVault(file, (pct) => setUploadProgress(pct));
        setUploadingCreative(creative);
      } catch (err: any) {
        const msg = err?.response?.data?.detail || 'Upload failed';
        alert(msg);
      }
    }
  };

  const handleProcessingComplete = (creative: UserCreative) => {
    setUploadingCreative(null);
    setUploadProgress(0);
    fetchCreatives();
  };

  const handleProcessingDismiss = () => {
    setUploadingCreative(null);
    setUploadProgress(0);
    fetchCreatives();
  };

  const handleEditorNeeded = (creative: UserCreative) => {
    setUploadingCreative(null);
    setUploadProgress(0);
    setIsMandatoryEdit(true);
    setEditTarget(creative);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCreativeFromVault(deleteTarget.id);
      setCreatives(prev => prev.filter(c => c.id !== deleteTarget.id));
    } catch { }
    setDeleteTarget(null);
  };

  return (
    <div className="mc-page">
      <div className="mc-header">
        <div>
          <h1 className="mc-title">{t('myCreatives')}</h1>
          <p className="mc-subtitle">{t('myCreativesDesc')}</p>
        </div>
        <label className="mc-upload-btn">
          <input
            type="file"
            accept="image/*,video/*,.heic,.heif"
            multiple
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUpload(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          {t('uploadCreative')}
        </label>
      </div>

      <div className="mc-filters">
        {(['all', 'image', 'video'] as FilterType[]).map(f => (
          <button
            key={f}
            className={`mc-filter-btn ${filter === f ? 'mc-filter-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('allTypes') : f === 'image' ? t('images') : t('videos')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mc-loading">
          <div className="mc-spinner" />
        </div>
      ) : creatives.length === 0 ? (
        <div className="mc-empty">
          <svg viewBox="0 0 48 48" fill="none" width="64" height="64"><rect x="6" y="10" width="36" height="28" rx="4" stroke="#ccc" strokeWidth="1.5"/><circle cx="18" cy="22" r="3" stroke="#ccc" strokeWidth="1.5"/><path d="M6 32l10-8 8 6 8-10 10 12" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <h3>{t('noCreatives')}</h3>
          <p>{t('noCreativesDesc')}</p>
        </div>
      ) : (
        <div className="mc-grid">
          {creatives.map(c => (
            <div key={c.id} className={`mc-card ${c.processing_status !== 'ready' ? 'mc-card-processing' : ''}`}>
              <div className="mc-card-thumb">
                {c.thumbnail_url ? (
                  <img src={`${API_URL}${c.thumbnail_url}`} alt={c.original_filename} />
                ) : c.file_type === 'video' ? (
                  <VideoThumbnail source={`${API_URL}${c.file_url}`} />
                ) : (
                  <img src={`${API_URL}${c.file_url}`} alt={c.original_filename} />
                )}
                {c.file_type === 'video' && (
                  <span className="mc-badge mc-badge-video">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : ''}
                  </span>
                )}
                {c.file_type === 'image' && (
                  <span className="mc-badge mc-badge-image">IMG</span>
                )}
                {c.processing_status === 'ready' && c.width && c.height && (
                  <span className="mc-badge mc-badge-res">{c.width}x{c.height}</span>
                )}
                {(c.processing_status === 'processing' || c.processing_status === 'uploading') && (
                  <div className="mc-card-processing-overlay">
                    <div className="mc-card-spinner" />
                    <span>{t('processing')}</span>
                  </div>
                )}
                {c.processing_status === 'failed' && (
                  <div className="mc-card-failed-overlay">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    <span>{t('processingFailed')}</span>
                  </div>
                )}
              </div>
              <div className="mc-card-info">
                <span className="mc-card-name" title={c.original_filename}>{c.original_filename}</span>
                <div className="mc-card-meta">
                  {c.width && c.height && <span>{c.width}x{c.height}</span>}
                  <span>{formatFileSize(c.file_size_bytes)}</span>
                </div>
              </div>
              {c.processing_status === 'ready' && c.file_type !== 'video' && (
                <button
                  className="mc-card-edit"
                  onClick={(e) => { e.stopPropagation(); setEditTarget(c); }}
                  title={t('editCreative')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
              <button
                className="mc-card-delete"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                title={t('deleteCreative')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <AppModal
          title={t('deleteConfirmTitle')}
          message={t('deleteConfirmMessage')}
          type="confirm"
          variant="danger"
          confirmText={t('delete')}
          cancelText={t('cancel')}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Processing overlay */}
      {uploadingCreative && (
        <ProcessingOverlay
          creative={uploadingCreative}
          uploadProgress={uploadProgress}
          onComplete={handleProcessingComplete}
          onDismiss={handleProcessingDismiss}
          onEditorNeeded={handleEditorNeeded}
        />
      )}

      {/* LEADS Editor modal */}
      {editTarget && (
        <LeadsEditor
          creative={editTarget}
          mandatory={isMandatoryEdit}
          onApply={(updated) => {
            setEditTarget(null);
            setIsMandatoryEdit(false);
            fetchCreatives();
          }}
          onClose={() => {
            setEditTarget(null);
            setIsMandatoryEdit(false);
          }}
        />
      )}
    </div>
  );
}
