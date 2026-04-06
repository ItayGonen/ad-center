import { createContext, useContext, useState, useCallback, useRef } from 'react';
import AppModal from '../components/AppModal';

interface ModalOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

interface ModalState extends ModalOptions {
  type: 'alert' | 'confirm';
}

interface ModalContextValue {
  alert: (options: ModalOptions) => Promise<void>;
  confirm: (options: ModalOptions) => Promise<boolean>;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const resolveRef = useRef<((value: any) => void) | null>(null);

  const alert = useCallback((options: ModalOptions): Promise<void> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setModal({ ...options, type: 'alert' });
    });
  }, []);

  const confirm = useCallback((options: ModalOptions): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setModal({ ...options, type: 'confirm' });
    });
  }, []);

  function handleClose(result: boolean) {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setModal(null);
    if (resolve) resolve(modal?.type === 'alert' ? undefined : result);
  }

  return (
    <ModalContext.Provider value={{ alert, confirm }}>
      {children}
      {modal && (
        <AppModal
          title={modal.title}
          message={modal.message}
          type={modal.type}
          variant={modal.variant || 'default'}
          confirmText={modal.confirmText}
          cancelText={modal.cancelText}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
    </ModalContext.Provider>
  );
}
