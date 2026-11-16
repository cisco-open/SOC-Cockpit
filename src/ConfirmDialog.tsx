// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert, Trash2 } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Asks the user to confirm a destructive action in an in-app dialog.
 * Returns `confirm(options)`, which resolves to true only when the user picks the confirm button,
 * and the dialog element, which the caller renders once.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    pendingRef.current = { ...options, resolve };
    setPending(pendingRef.current);
  }), []);

  const close = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const dialog = pending ? <ConfirmDialog options={pending} onClose={close} /> : null;
  return [confirm, dialog];
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (confirmed: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Cancel has focus first, so pressing Enter by habit does not delete anything.
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className="ac-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(false); }}>
      <div className="ac-modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <header className="ac-modal-head">
          <h2 id={titleId}><TriangleAlert size={18} className="confirm-icon" aria-hidden="true" /> {options.title}</h2>
        </header>
        <div className="ac-modal-body">
          <div id={messageId} className="confirm-message">{options.message}</div>
          <footer className="ac-modal-foot">
            <button ref={cancelRef} type="button" className="ac-btn" onClick={() => onClose(false)}>{options.cancelLabel ?? 'Cancel'}</button>
            <button ref={confirmRef} type="button" className="ac-btn danger-solid" onClick={() => onClose(true)}><Trash2 size={16} aria-hidden="true" /> {options.confirmLabel ?? 'Delete'}</button>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
