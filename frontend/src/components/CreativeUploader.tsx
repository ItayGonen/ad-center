import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar, Alert } from '@mui/material';
import type { Creative } from '../services/orders';
import type { UserCreative } from '../services/myCreatives';
import { API_URL } from '../services/api';
import MediaGuidelines from './MediaGuidelines';
import VideoThumbnail from './VideoThumbnail';
import CreativeVaultPicker from './CreativeVaultPicker';
import { validateFiles } from '../utils/fileValidation';

interface CreativeUploaderProps {
  creativeFiles: File[];
  existingCreatives?: Creative[];
  onFilesChange: (files: File[]) => void;
  onDeleteExisting?: (id: number) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  maxFiles?: number;
  uploadProgress?: Map<number, number>;
  onVaultCreativeSelected?: (creative: UserCreative) => void;
  spaceId?: number;
}

export default function CreativeUploader({
  creativeFiles,
  existingCreatives = [],
  onFilesChange,
  onDeleteExisting,
  notes,
  onNotesChange,
  maxFiles = 5,
  uploadProgress,
  onVaultCreativeSelected,
  spaceId,
}: CreativeUploaderProps) {
  const { t } = useTranslation('orders');
  const { t: tc } = useTranslation('creatives');
  const totalCount = existingCreatives.length + creativeFiles.length;
  const [validationError, setValidationError] = useState('');
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  const handleFilesSelected = async (newFiles: File[], append: boolean) => {
    const { validFiles, errors } = await validateFiles(newFiles);
    if (errors.length > 0) {
      setValidationError(errors.join('\n'));
    }
    if (validFiles.length > 0) {
      if (append) {
        const remaining = maxFiles - totalCount;
        onFilesChange([...creativeFiles, ...validFiles.slice(0, remaining)]);
      } else {
        onFilesChange(validFiles.slice(0, maxFiles));
      }
    }
  };

  return (
    <div className="bf-section bf-animate-in">
      {/* <h2 className="bf-step-title">{t('uploadMedia')}</h2> */}
      {/* <p className="bf-step-desc">{t('uploadMediaDesc')}</p> */}

      {/* Upload */}
      <div className="bf-upload-zone">
        <span className="bf-upload-zone-label">{t('creative')} <span className="bf-upload-zone-counter">{t('imagesCount', { count: totalCount, max: maxFiles })}</span></span>

        {totalCount > 0 ? (
          <>
            <div className="bf-upload-grid">
              {existingCreatives.map(c => (
                <div key={`existing-${c.id}`} className="bf-upload-grid-item">
                  {c.file_type === 'image' ? (
                    <img src={`${API_URL}${c.file_url}`} alt="" />
                  ) : (
                    <VideoThumbnail source={`${API_URL}${c.file_url}`} />
                  )}
                  {onDeleteExisting && (
                    <button className="bf-upload-grid-item-remove" onClick={() => onDeleteExisting(c.id)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              ))}
              {creativeFiles.map((file, idx) => {
                const pct = uploadProgress?.get(idx);
                return (
                  <div key={`new-${idx}`} className="bf-upload-grid-item">
                    {file.type.startsWith('image/') ? (
                      <img src={URL.createObjectURL(file)} alt="" />
                    ) : (
                      <VideoThumbnail source={file} />
                    )}
                    <button className="bf-upload-grid-item-remove" onClick={() => onFilesChange(creativeFiles.filter((_, i) => i !== idx))}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    {pct !== undefined && pct < 100 && (
                      <div className="bf-upload-progress-overlay">
                        <div className="bf-upload-progress-bar" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
              {totalCount < maxFiles && (
                <label className="bf-upload-grid-add">
                  <input type="file" accept="image/*,video/*" multiple onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    if (!e.target.files) return;
                    const remaining = maxFiles - totalCount;
                    if (remaining <= 0) return;
                    const newFiles = Array.from(e.target.files);
                    e.target.value = '';
                    handleFilesSelected(newFiles.slice(0, remaining), true);
                  }} />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </label>
              )}
            </div>
            {totalCount > 1 && (
              <div className="bf-upload-notice">
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                <span>{t('imageDivisionNotice')}</span>
              </div>
            )}
          </>
        ) : (
          <label
            className="bf-upload-zone-droparea"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragging'); }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); }}
            onDrop={(e) => {
              e.preventDefault(); e.currentTarget.classList.remove('dragging');
              const droppedFiles = Array.from(e.dataTransfer.files);
              if (droppedFiles.length === 0) return;
              handleFilesSelected(droppedFiles.slice(0, maxFiles), false);
            }}
          >
            <input type="file" accept="image/*,video/*" multiple onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (!e.target.files) return;
              const picked = Array.from(e.target.files).slice(0, maxFiles);
              e.target.value = '';
              handleFilesSelected(picked, false);
            }} />
            <div className="bf-upload-zone-icon">
              <svg viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="1.5"/><circle cx="18" cy="22" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M6 32l10-8 8 6 8-10 10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="bf-upload-zone-title">{t('dropFilesHere')}</span>
            <span className="bf-upload-zone-hint">{t('orClickTo')} <strong>{t('browseFiles')}</strong></span>
            <span className="bf-upload-zone-formats">{t('supportedFormats')}</span>
          </label>
        )}
      </div>

      {onVaultCreativeSelected && (
        <button
          type="button"
          className="bf-vault-btn"
          onClick={() => setShowVaultPicker(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
            borderRadius: 10, border: '1px solid #e0e0e0', background: '#fafafa',
            color: '#555', fontSize: '0.88rem', cursor: 'pointer', marginTop: 10,
            transition: 'border-color 0.2s',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          {tc('chooseFromVault')}
        </button>
      )}

      <MediaGuidelines />

      <div className="bf-notes-compact">
        <textarea value={notes} onChange={e => onNotesChange(e.target.value)} placeholder={t('addNoteOptional')} rows={2} />
      </div>

      <Snackbar open={!!validationError} autoHideDuration={5000} onClose={() => setValidationError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setValidationError('')} sx={{ whiteSpace: 'pre-line' }}>{validationError}</Alert>
      </Snackbar>

      {showVaultPicker && onVaultCreativeSelected && (
        <CreativeVaultPicker
          spaceId={spaceId}
          onSelect={(creative) => {
            setShowVaultPicker(false);
            onVaultCreativeSelected(creative);
          }}
          onClose={() => setShowVaultPicker(false)}
        />
      )}
    </div>
  );
}
