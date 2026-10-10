'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './library-view.module.css';

export interface LibraryToastState {
  id: number;
  message: string;
  tone: 'info' | 'error';
  onUndo?: () => void;
}

const TOAST_MS = 8000;

interface LibraryToastProps {
  toast: LibraryToastState | null;
  /** Lifts the toast above the selection bar on narrow screens. */
  raised: boolean;
  onDismiss: () => void;
}

export function LibraryToast({ toast, raised, onDismiss }: LibraryToastProps) {
  const toastId = toast?.id;

  // A new toast has a new id, which restarts the timer. Clearing on unmount stops a stale timer.
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastId, onDismiss]);

  const handleUndo = () => {
    const undo = toast?.onUndo;
    onDismiss();
    undo?.();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${styles.toastHost} ${raised ? styles.toastRaised : ''}`}
    >
      {toast ? (
        <div className={`${styles.toast} ${toast.tone === 'error' ? styles.toastError : ''}`}>
          <span className={styles.toastText}>{toast.message}</span>
          {toast.onUndo ? (
            <button type="button" className={styles.toastAction} onClick={handleUndo}>
              Hoàn tác
            </button>
          ) : null}
          <button type="button" className={styles.toastClose} aria-label="Đóng thông báo" onClick={onDismiss}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
