interface AppModalProps {
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  variant: 'default' | 'danger';
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AppModal({ title, message, type, variant, confirmText, cancelText, onConfirm, onCancel }: AppModalProps) {
  return (
    <div className="app-modal-overlay" onClick={onCancel}>
      <div className="app-modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="app-modal-title">{title}</h3>
        <p className="app-modal-message">{message}</p>
        <div className="app-modal-buttons">
          {type === 'confirm' && (
            <button className="app-modal-btn app-modal-btn-secondary" onClick={onCancel}>
              {cancelText || 'Cancel'}
            </button>
          )}
          <button
            className={`app-modal-btn ${variant === 'danger' ? 'app-modal-btn-danger' : 'app-modal-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmText || (type === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
