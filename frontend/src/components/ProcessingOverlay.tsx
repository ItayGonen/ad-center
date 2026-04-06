import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCreativeDetail } from '../services/myCreatives';
import type { UserCreative } from '../services/myCreatives';
import './ProcessingOverlay.css';

interface ProcessingOverlayProps {
  creative: UserCreative;
  uploadProgress: number;
  onComplete: (creative: UserCreative) => void;
  onDismiss: () => void;
  onEditorNeeded?: (creative: UserCreative) => void;
}

const STEP_MAP: Record<string, number> = {
  scanning: 1,
  extracting: 2,
};

export default function ProcessingOverlay({ creative, uploadProgress, onComplete, onDismiss, onEditorNeeded }: ProcessingOverlayProps) {
  const { t } = useTranslation('creatives');
  const [currentCreative, setCurrentCreative] = useState<UserCreative>(creative);
  const [timedOut, setTimedOut] = useState(false);
  const [uploadDone, setUploadDone] = useState(uploadProgress >= 100);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Track upload completion
  useEffect(() => {
    if (uploadProgress >= 100 && !uploadDone) {
      setUploadDone(true);
    }
  }, [uploadProgress, uploadDone]);

  // Start polling + timeout once upload is done
  useEffect(() => {
    if (!uploadDone) return;

    // Mark upload step as completed
    setCompletedSteps(prev => new Set(prev).add(0));

    // 30s timeout
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, 30000);

    // Poll every 2s
    pollRef.current = setInterval(async () => {
      try {
        const detail = await getCreativeDetail(currentCreative.id);
        setCurrentCreative(detail);

        // Track completed steps progressively
        const step = STEP_MAP[detail.processing_step || ''] || 1;
        setCompletedSteps(prev => {
          const next = new Set(prev);
          for (let i = 0; i < step; i++) next.add(i);
          return next;
        });

        if (detail.processing_step === 'awaiting_editor' && onEditorNeeded) {
          // Backend finished extracting — hand off to mandatory editor
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
          setCompletedSteps(new Set([0, 1, 2]));
          setTimeout(() => onEditorNeeded(detail), 600);
        } else if (detail.processing_status === 'ready') {
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
          setCompletedSteps(prev => { const n = new Set(prev); n.add(0); n.add(1); n.add(2); return n; });
          setTimeout(() => onComplete(detail), 1500);
        } else if (detail.processing_status === 'failed') {
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return () => {
      clearInterval(pollRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [uploadDone, currentCreative.id, onComplete]);

  const activeStep = (() => {
    if (!uploadDone) return 0;
    if (currentCreative.processing_status === 'ready') return 3; // all done
    if (currentCreative.processing_step === 'awaiting_editor') return 3; // extracting done
    if (currentCreative.processing_status === 'failed') return -1;
    return STEP_MAP[currentCreative.processing_step || ''] || 1;
  })();

  const steps = [
    { key: 0, label: t('poUploading'), icon: 'upload' },
    { key: 1, label: t('poScanning'), icon: 'shield' },
    { key: 2, label: t('poExtracting'), icon: 'extract' },
  ];

  const isFailed = currentCreative.processing_status === 'failed';
  const isComplete = activeStep === 3;

  // Timed-out: background processing card
  if (timedOut && !isComplete && !isFailed) {
    return (
      <div className="po-overlay po-overlay-locked">
        <div className="po-card po-card-background">
          <div className="po-bg-glow" />
          <div className="po-background-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="52" height="52"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h3 className="po-title">{t('poBackground')}</h3>
          <p className="po-desc">{t('poBackgroundDesc')}</p>
          <button className="po-btn po-btn-primary" onClick={onDismiss}>{t('poGotIt')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="po-overlay po-overlay-locked">
      <div className={`po-card ${isComplete ? 'po-card-success' : ''} ${isFailed ? 'po-card-error' : ''}`}>
        {/* Decorative glow behind the card */}
        <div className="po-bg-glow" />

        {/* Success state */}
        {isComplete && (
          <div className="po-result">
            <div className="po-success-ring">
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h3 className="po-title po-title-success">{t('poComplete')}</h3>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="po-result">
            <div className="po-fail-ring">
              <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </div>
            <h3 className="po-title po-title-error">{t('poFailed')}</h3>
            {currentCreative.processing_error && (
              <p className="po-error-msg">{currentCreative.processing_error}</p>
            )}
            <button className="po-btn po-btn-primary" onClick={onDismiss}>{t('poDismiss')}</button>
          </div>
        )}

        {/* Active processing steps */}
        {!isComplete && !isFailed && (
          <>
            <p className="po-subtitle">{t('poSubtitle')}</p>

            <div className="po-steps">
              {steps.map((step, i) => {
                const isDone = completedSteps.has(step.key) || activeStep > step.key;
                const isActive = activeStep === step.key;
                const isPending = !isDone && !isActive;

                return (
                  <div key={step.key} className={`po-step ${isDone ? 'po-step-done' : ''} ${isActive ? 'po-step-active' : ''} ${isPending ? 'po-step-pending' : ''}`}>
                    {/* Connecting line (above current step, except first) */}
                    {i > 0 && (
                      <div className={`po-step-connector ${isDone || isActive ? 'po-step-connector-filled' : ''}`} />
                    )}

                    <div className="po-step-row">
                      <div className="po-step-indicator">
                        {isDone ? (
                          <div className="po-check-circle">
                            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg>
                          </div>
                        ) : isActive ? (
                          <div className="po-pulse-ring">
                            <div className="po-spinner" />
                          </div>
                        ) : (
                          <div className="po-step-dot" />
                        )}
                      </div>

                      <div className="po-step-content">
                        <span className="po-step-label">{step.label}</span>
                        {/* Upload progress bar for step 0 */}
                        {isActive && step.key === 0 && uploadProgress < 100 && (
                          <div className="po-progress-track">
                            <div className="po-progress-fill" style={{ width: `${uploadProgress}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Completed steps timeline (shown in success state too) */}
        {isComplete && (
          <div className="po-steps po-steps-complete">
            {steps.map((step) => (
              <div key={step.key} className="po-step po-step-done">
                <div className="po-step-row">
                  <div className="po-step-indicator">
                    <div className="po-check-circle">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                  </div>
                  <span className="po-step-label">{step.label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
