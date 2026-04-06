import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyCreatives, validateCreativeForCampaign } from '../services/myCreatives';
import type { UserCreative, ValidationIssue } from '../services/myCreatives';
import { API_URL } from '../services/api';
import VideoThumbnail from './VideoThumbnail';
import './CreativeVaultPicker.css';

interface CreativeVaultPickerProps {
  onSelect: (creative: UserCreative) => void;
  onClose: () => void;
  spaceId?: number;
}

export default function CreativeVaultPicker({ onSelect, onClose, spaceId }: CreativeVaultPickerProps) {
  const { t } = useTranslation('creatives');
  const [creatives, setCreatives] = useState<UserCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [validationDone, setValidationDone] = useState(false);

  useEffect(() => {
    getMyCreatives(1, 100)
      .then(res => setCreatives(res.items.filter(c => c.processing_status === 'ready')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (creative: UserCreative) => {
    setSelectedId(creative.id);
    setValidationIssues([]);
    setValidationDone(false);

    if (spaceId) {
      setValidating(true);
      try {
        const result = await validateCreativeForCampaign(creative.id, spaceId);
        setValidationIssues(result.issues);
        setValidationDone(true);
      } catch {
        setValidationDone(true);
      } finally {
        setValidating(false);
      }
    } else {
      setValidationDone(true);
    }
  };

  const handleConfirm = () => {
    const creative = creatives.find(c => c.id === selectedId);
    if (creative) onSelect(creative);
  };

  return (
    <div className="cvp-overlay" onClick={onClose}>
      <div className="cvp-modal" onClick={e => e.stopPropagation()}>
        <div className="cvp-header">
          <h2 className="cvp-title">{t('vaultPickerTitle')}</h2>
          <button className="cvp-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="cvp-body">
          {loading ? (
            <div className="cvp-loading">
              <div className="cvp-spinner" />
            </div>
          ) : creatives.length === 0 ? (
            <div className="cvp-empty">{t('vaultPickerEmpty')}</div>
          ) : (
            <div className="cvp-grid">
              {creatives.map(c => (
                <button
                  key={c.id}
                  className={`cvp-item ${selectedId === c.id ? 'cvp-item-selected' : ''} ${validating && selectedId === c.id ? 'cvp-item-validating' : ''}`}
                  onClick={() => handleSelect(c)}
                >
                  <div className="cvp-thumb">
                    {c.thumbnail_url ? (
                      <img src={`${API_URL}${c.thumbnail_url}`} alt={c.original_filename} />
                    ) : c.file_type === 'video' ? (
                      <VideoThumbnail source={`${API_URL}${c.file_url}`} />
                    ) : (
                      <img src={`${API_URL}${c.file_url}`} alt={c.original_filename} />
                    )}
                    {c.file_type === 'video' && (
                      <span className="cvp-badge-video">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </span>
                    )}
                  </div>
                  <span className="cvp-name">{c.original_filename}</span>
                  {selectedId === c.id && (
                    <div className="cvp-check">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Validation results */}
          {validationDone && selectedId && validationIssues.length > 0 && (
            <div className="cvp-warnings">
              <h4 className="cvp-warnings-title">{t('validationWarnings')}</h4>
              {validationIssues.map((issue, i) => (
                <div key={i} className="cvp-warning-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {validationDone && selectedId && validationIssues.length === 0 && (
            <div className="cvp-valid">
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M20 6 9 17l-5-5"/></svg>
              <span>{t('validationPassed')}</span>
            </div>
          )}
        </div>

        <div className="cvp-footer">
          <button className="cvp-btn-cancel" onClick={onClose}>{t('cancel')}</button>
          <button
            className="cvp-btn-select"
            disabled={!selectedId || validating}
            onClick={handleConfirm}
          >
            {validating ? t('validating') : t('vaultPickerSelect')}
          </button>
        </div>
      </div>
    </div>
  );
}
