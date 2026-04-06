import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmOrderWithProof } from '../services/admin';
import type { AdminOrder } from '../services/admin';

interface PaymentProofModalProps {
  order: AdminOrder;
  onClose: () => void;
  onConfirmed: (updatedOrder: AdminOrder) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function PaymentProofModal({ order, onClose, onConfirmed }: PaymentProofModalProps) {
  const { t } = useTranslation('admin');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setError('');
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError(t('proofInvalidType', { defaultValue: 'Only JPEG, PNG, and WebP images are allowed' }));
      return;
    }
    if (f.size > MAX_SIZE) {
      setError(t('proofTooLarge', { defaultValue: 'File must be under 10MB' }));
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, [t]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }

  function removeFile() {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const updated = await confirmOrderWithProof(order.id, file);
      onConfirmed(updated);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('proofUploadFailed', { defaultValue: 'Failed to confirm order. Please try again.' }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="ao-modal-overlay" onClick={onClose}>
      <div className="pp-modal" onClick={e => e.stopPropagation()}>
        <div className="ao-modal-header">
          <div>
            <h3 className="ao-modal-title">{t('confirmWithProof', { defaultValue: 'Confirm Order & Upload Payment Proof' })}</h3>
            <p className="ao-modal-subtitle">
              {order.reference_number} &middot; {order.user_name} &middot; &#8362;{order.total_cost.toLocaleString()}
            </p>
          </div>
          <button className="ao-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="ao-modal-body">
          {error && <div className="pp-error">{error}</div>}

          {!file ? (
            <div
              className={`pp-dropzone ${dragOver ? 'pp-dropzone-active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => inputRef.current?.click()}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p className="pp-dropzone-text">{t('proofDropzone', { defaultValue: 'Drag & drop payment proof here, or click to browse' })}</p>
              <p className="pp-dropzone-hint">{t('proofFormats', { defaultValue: 'JPEG, PNG, or WebP up to 10MB' })}</p>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleInputChange}
                style={{ display: 'none' }}
              />
            </div>
          ) : (
            <div className="pp-preview-wrap">
              <img src={preview!} alt="Payment proof" className="pp-preview-img" />
              <button className="pp-remove-btn" onClick={removeFile}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                {t('remove', { ns: 'common', defaultValue: 'Remove' })}
              </button>
            </div>
          )}

          <div className="pp-actions">
            <button className="btn-secondary" onClick={onClose} disabled={uploading}>
              {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
            </button>
            <button className="btn-primary" onClick={handleSubmit} disabled={!file || uploading}>
              {uploading ? t('uploading', { defaultValue: 'Uploading...' }) : t('confirmAndUpload', { defaultValue: 'Confirm & Upload' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
