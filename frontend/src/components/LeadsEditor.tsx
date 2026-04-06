import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API_URL } from '../services/api';
import { applyEditorTransform } from '../services/myCreatives';
import type { UserCreative, CropRect } from '../services/myCreatives';
import './LeadsEditor.css';

interface LeadsEditorProps {
  creative: UserCreative;
  onApply: (updated: UserCreative) => void;
  onClose: () => void;
  mandatory?: boolean;
}

function getTargetAspect(width: number, height: number): number {
  return width >= height ? 16 / 9 : 9 / 16;
}

type DragMode = null | 'move' | 'tl' | 'tr' | 'bl' | 'br';

export default function LeadsEditor({ creative, onApply, onClose, mandatory = false }: LeadsEditorProps) {
  const { t } = useTranslation('creatives');
  const [rotation, setRotation] = useState(0);
  const [cropEnabled, setCropEnabled] = useState(mandatory);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [applying, setApplying] = useState(false);

  // Canvas/preview refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Drag state for crop interaction
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);

  // Original image dimensions (natural)
  const [naturalW, setNaturalW] = useState(creative.width || 1920);
  const [naturalH, setNaturalH] = useState(creative.height || 1080);
  // Displayed (canvas) dimensions
  const [displayW, setDisplayW] = useState(0);
  const [displayH, setDisplayH] = useState(0);

  const isVideo = creative.file_type === 'video';
  const mediaUrl = mandatory && creative.original_url
    ? `${API_URL}${creative.original_url}`
    : `${API_URL}${creative.file_url}`;

  // Load image and draw to canvas
  useEffect(() => {
    if (isVideo) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setNaturalW(img.naturalWidth);
      setNaturalH(img.naturalHeight);
      drawCanvas(img);
    };
    img.src = mediaUrl;
  }, [mediaUrl, isVideo]);

  const drawCanvas = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Fit canvas within container
    const maxW = 860;
    const maxH = 500;
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    // Apply rotation to dimensions for display
    if (rotation === 90 || rotation === 270) {
      [w, h] = [h, w];
    }

    const scale = Math.min(maxW / w, maxH / h, 1);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);

    canvas.width = dw;
    canvas.height = dh;
    setDisplayW(dw);
    setDisplayH(dh);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, dw, dh);
    ctx.save();

    // Apply rotation transform
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw centered
    const drawW = rotation === 90 || rotation === 270 ? dh : dw;
    const drawH = rotation === 90 || rotation === 270 ? dw : dh;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

    ctx.restore();
  }, [rotation]);

  // Redraw when rotation changes
  useEffect(() => {
    if (imageRef.current && !isVideo) {
      drawCanvas(imageRef.current);
    }
  }, [rotation, drawCanvas, isVideo]);

  // Initialize crop rect when crop is enabled
  useEffect(() => {
    if (!cropEnabled) {
      setCropRect(null);
      return;
    }

    // Get effective dimensions after rotation
    let effW = naturalW;
    let effH = naturalH;
    if (rotation === 90 || rotation === 270) {
      [effW, effH] = [effH, effW];
    }

    if (mandatory) {
      // Mandatory mode: default crop = full image
      setCropRect({ x: 0, y: 0, width: effW, height: effH });
    } else {
      const targetAspect = getTargetAspect(effW, effH);

      // Default crop: centered, max area matching target aspect
      let cropW: number, cropH: number;
      if (effW / effH > targetAspect) {
        cropH = effH;
        cropW = Math.round(effH * targetAspect);
      } else {
        cropW = effW;
        cropH = Math.round(effW / targetAspect);
      }

      const cropX = Math.round((effW - cropW) / 2);
      const cropY = Math.round((effH - cropH) / 2);

      setCropRect({ x: cropX, y: cropY, width: cropW, height: cropH });
    }
  }, [cropEnabled, naturalW, naturalH, rotation, mandatory]);

  // ── Crop drag interaction ──
  const getEffectiveDims = useCallback(() => {
    let eW = naturalW;
    let eH = naturalH;
    if (rotation === 90 || rotation === 270) [eW, eH] = [eH, eW];
    return { eW, eH };
  }, [naturalW, naturalH, rotation]);

  const handleCropPointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (!cropRect || applying) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...cropRect },
    };
  }, [cropRect, applying]);

  const handleCropPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !cropRect) return;

    const { eW, eH } = getEffectiveDims();
    const sX = displayW > 0 ? displayW / eW : 1;
    const sY = displayH > 0 ? displayH / eH : 1;

    // Delta in natural coordinates
    const dx = (e.clientX - drag.startX) / sX;
    const dy = (e.clientY - drag.startY) / sY;
    const sr = drag.startRect;

    const MIN_SIZE = 40;
    let newRect: CropRect;

    if (drag.mode === 'move') {
      let nx = Math.round(sr.x + dx);
      let ny = Math.round(sr.y + dy);
      nx = Math.max(0, Math.min(nx, eW - sr.width));
      ny = Math.max(0, Math.min(ny, eH - sr.height));
      newRect = { x: nx, y: ny, width: sr.width, height: sr.height };
    } else {
      // Aspect-ratio-locked corner resize
      const aspect = getTargetAspect(eW, eH);
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let newWidth: number;
      let newHeight: number;
      let newX = sr.x;
      let newY = sr.y;

      if (drag.mode === 'br') {
        if (absDx >= absDy) {
          newWidth = Math.max(MIN_SIZE, Math.min(Math.round(sr.width + dx), eW - sr.x));
          newHeight = Math.round(newWidth / aspect);
        } else {
          newHeight = Math.max(MIN_SIZE, Math.min(Math.round(sr.height + dy), eH - sr.y));
          newWidth = Math.round(newHeight * aspect);
        }
        if (newX + newWidth > eW) { newWidth = eW - newX; newHeight = Math.round(newWidth / aspect); }
        if (newY + newHeight > eH) { newHeight = eH - newY; newWidth = Math.round(newHeight * aspect); }
      } else if (drag.mode === 'bl') {
        if (absDx >= absDy) {
          newWidth = Math.max(MIN_SIZE, Math.min(Math.round(sr.width - dx), sr.x + sr.width));
          newHeight = Math.round(newWidth / aspect);
          newX = sr.x + sr.width - newWidth;
        } else {
          newHeight = Math.max(MIN_SIZE, Math.min(Math.round(sr.height + dy), eH - sr.y));
          newWidth = Math.round(newHeight * aspect);
          newX = sr.x + sr.width - newWidth;
        }
        if (newX < 0) { newX = 0; newWidth = sr.x + sr.width; newHeight = Math.round(newWidth / aspect); }
        if (newY + newHeight > eH) { newHeight = eH - newY; newWidth = Math.round(newHeight * aspect); newX = sr.x + sr.width - newWidth; }
      } else if (drag.mode === 'tr') {
        if (absDx >= absDy) {
          newWidth = Math.max(MIN_SIZE, Math.min(Math.round(sr.width + dx), eW - sr.x));
          newHeight = Math.round(newWidth / aspect);
          newY = sr.y + sr.height - newHeight;
        } else {
          newHeight = Math.max(MIN_SIZE, Math.min(Math.round(sr.height - dy), sr.y + sr.height));
          newWidth = Math.round(newHeight * aspect);
          newY = sr.y + sr.height - newHeight;
        }
        if (newX + newWidth > eW) { newWidth = eW - newX; newHeight = Math.round(newWidth / aspect); newY = sr.y + sr.height - newHeight; }
        if (newY < 0) { newY = 0; newHeight = sr.y + sr.height; newWidth = Math.round(newHeight * aspect); }
      } else if (drag.mode === 'tl') {
        if (absDx >= absDy) {
          newWidth = Math.max(MIN_SIZE, Math.min(Math.round(sr.width - dx), sr.x + sr.width));
          newHeight = Math.round(newWidth / aspect);
          newX = sr.x + sr.width - newWidth;
          newY = sr.y + sr.height - newHeight;
        } else {
          newHeight = Math.max(MIN_SIZE, Math.min(Math.round(sr.height - dy), sr.y + sr.height));
          newWidth = Math.round(newHeight * aspect);
          newX = sr.x + sr.width - newWidth;
          newY = sr.y + sr.height - newHeight;
        }
        if (newX < 0) { newX = 0; newWidth = sr.x + sr.width; newHeight = Math.round(newWidth / aspect); newY = sr.y + sr.height - newHeight; }
        if (newY < 0) { newY = 0; newHeight = sr.y + sr.height; newWidth = Math.round(newHeight * aspect); newX = sr.x + sr.width - newWidth; }
      } else {
        newWidth = sr.width;
        newHeight = sr.height;
      }

      // Final safety clamp
      newWidth = Math.max(MIN_SIZE, newWidth);
      newHeight = Math.max(MIN_SIZE, newHeight);
      newX = Math.max(0, Math.min(newX, eW - newWidth));
      newY = Math.max(0, Math.min(newY, eH - newHeight));

      newRect = { x: Math.round(newX), y: Math.round(newY), width: Math.round(newWidth), height: Math.round(newHeight) };
    }

    setCropRect(newRect);
  }, [cropRect, displayW, displayH, getEffectiveDims]);

  const handleCropPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleReset = () => {
    setRotation(0);
    setCropEnabled(mandatory);
    setCropRect(null);
    // Re-trigger crop init for mandatory
    if (mandatory) {
      setTimeout(() => setCropEnabled(true), 0);
    }
  };

  const handleApply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const transform: { rotation?: number; crop?: CropRect } = {};
      if (rotation !== 0) transform.rotation = rotation;
      if (cropEnabled && cropRect) transform.crop = cropRect;

      // In mandatory mode, always send crop so backend processes the file
      if (mandatory && !transform.crop && cropRect) {
        transform.crop = cropRect;
      }

      const updated = await applyEditorTransform(creative.id, transform);
      onApply(updated);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Failed to apply changes';
      alert(msg);
    } finally {
      setApplying(false);
    }
  };

  const hasChanges = mandatory || rotation !== 0 || (cropEnabled && cropRect !== null);

  // Scale factor from natural to display coordinates
  let effW = naturalW;
  let effH = naturalH;
  if (rotation === 90 || rotation === 270) {
    [effW, effH] = [effH, effW];
  }
  const scaleX = displayW > 0 ? displayW / effW : 1;
  const scaleY = displayH > 0 ? displayH / effH : 1;

  return (
    <div className="le-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying && !mandatory) onClose(); }}>
      <div className="le-card">
        {/* Header */}
        <div className="le-header">
          <div className="le-header-left">
            <h3 className="le-title">{t('editorTitle')}</h3>
            {mandatory && (
              <p className="le-mandatory-desc">{t('editorMandatoryDesc')}</p>
            )}
          </div>
          {!mandatory && (
            <button className="le-close-btn" onClick={onClose} disabled={applying}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>

        {/* Body: sidebar + workspace */}
        <div className="le-body">
          {/* Sidebar toolbar */}
          <div className="le-sidebar">
            <button
              className="le-sidebar-btn"
              title={t('editorRotate') + ' -90°'}
              onClick={() => setRotation((r) => (r + 270) % 360)}
              disabled={applying}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button
              className="le-sidebar-btn"
              title={t('editorRotate') + ' +90°'}
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={applying}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
              </svg>
            </button>
            {!isVideo && (
              <>
                <div className="le-sidebar-divider" />
                <button
                  className={`le-sidebar-btn ${cropEnabled ? 'le-sidebar-btn-active' : ''}`}
                  title={t('editorCrop')}
                  onClick={() => setCropEnabled(c => !c)}
                  disabled={applying}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                    <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Workspace */}
          <div className="le-workspace">
            <div className="le-canvas-container" ref={containerRef}>
              {isVideo ? (
                <video
                  src={mediaUrl}
                  controls
                  muted
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    maxWidth: rotation === 90 || rotation === 270 ? '500px' : '860px',
                    maxHeight: rotation === 90 || rotation === 270 ? '860px' : '500px',
                  }}
                />
              ) : (
                <canvas ref={canvasRef} />
              )}

              {/* Crop rectangle overlay */}
              {cropEnabled && cropRect && displayW > 0 && !isVideo && (
                <div
                  className="le-crop-overlay"
                  style={{ width: displayW, height: displayH }}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerUp}
                >
                  <div
                    className="le-crop-rect"
                    style={{
                      left: cropRect.x * scaleX,
                      top: cropRect.y * scaleY,
                      width: cropRect.width * scaleX,
                      height: cropRect.height * scaleY,
                    }}
                    onPointerDown={(e) => handleCropPointerDown(e, 'move')}
                  >
                    <div className="le-crop-handle le-crop-handle-tl" onPointerDown={(e) => handleCropPointerDown(e, 'tl')} />
                    <div className="le-crop-handle le-crop-handle-tr" onPointerDown={(e) => handleCropPointerDown(e, 'tr')} />
                    <div className="le-crop-handle le-crop-handle-bl" onPointerDown={(e) => handleCropPointerDown(e, 'bl')} />
                    <div className="le-crop-handle le-crop-handle-br" onPointerDown={(e) => handleCropPointerDown(e, 'br')} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="le-footer">
          <div className="le-footer-left">
            <button className="le-btn le-btn-reset" onClick={handleReset} disabled={applying}>
              {t('editorReset')}
            </button>
          </div>
          <div className="le-footer-center">
            <span className="le-dimensions">
              {cropRect
                ? `${cropRect.width} × ${cropRect.height}px`
                : creative.width && creative.height
                  ? `${creative.width} × ${creative.height}px`
                  : null}
            </span>
          </div>
          <div className="le-footer-right">
            {!mandatory && (
              <button className="le-btn le-btn-secondary" onClick={onClose} disabled={applying}>
                {t('editorCancel')}
              </button>
            )}
            <button
              className="le-btn le-btn-primary"
              onClick={handleApply}
              disabled={!hasChanges || applying}
            >
              {applying
                ? t('editorApplying')
                : mandatory
                  ? t('editorConfirmApply')
                  : t('editorApply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
