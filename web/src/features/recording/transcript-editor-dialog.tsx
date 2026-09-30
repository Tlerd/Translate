'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CaptionItem } from '@/shared/recording';
import styles from './transcript-editor.module.css';

interface TranscriptEditorDialogProps {
  captions: CaptionItem[];
  onClose: () => void;
  onSave: (sources: Array<{ id: number; source: string }>) => Promise<void>;
}

export function TranscriptEditorDialog({ captions, onClose, onSave }: TranscriptEditorDialogProps) {
  const [draft, setDraft] = useState(() => captions.map(({ id, source }) => ({ id, source })));
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstInputRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  const close = () => {
    if (!saving) onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialogRef.current?.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const applyReplacement = () => {
    if (!search) {
      setError('Nhập nội dung cần tìm trước khi áp dụng.');
      return;
    }
    let matches = 0;
    const nextDraft = draft.map((line) => {
      const count = line.source.split(search).length - 1;
      matches += count;
      return { ...line, source: line.source.split(search).join(replacement) };
    });
    if (matches === 0) {
      setError('Không tìm thấy nội dung này trong kịch bản.');
      return;
    }
    setDraft(nextDraft);
    setError(null);
  };

  const handleSave = async () => {
    const emptyIndex = draft.findIndex((line) => !line.source.trim());
    if (emptyIndex >= 0) {
      setError(`Câu số ${emptyIndex + 1} đang để trống. Hãy nhập nội dung hoặc khôi phục câu đó trước khi lưu.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-editor-title"
        aria-describedby="transcript-editor-description"
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <div>
            <h2 id="transcript-editor-title" className={styles.title}>Chỉnh sửa kịch bản</h2>
            <p id="transcript-editor-description" className={styles.description}>
              Chỉnh sửa lời gốc theo từng câu. Bản dịch hiện tại được giữ lại và sẽ được đánh dấu cần cập nhật.
            </p>
          </div>
          <button className={styles.closeButton} type="button" onClick={close} aria-label="Đóng cửa sổ chỉnh sửa" disabled={saving}>
            <X size={20} />
          </button>
        </header>

        <section className={styles.tools} aria-label="Tìm và thay thế">
          <label className={styles.field}>
            Tìm nội dung
            <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className={styles.field}>
            Thay bằng
            <input className={styles.input} value={replacement} onChange={(event) => setReplacement(event.target.value)} />
          </label>
          <button className={styles.applyButton} type="button" onClick={applyReplacement}>Thay tất cả</button>
        </section>

        <div className={styles.rows}>
          {draft.map((line, index) => (
            <label className={styles.row} key={line.id}>
              <span className={styles.number} aria-hidden="true">{index + 1}.</span>
              <textarea
                ref={index === 0 ? firstInputRef : undefined}
                className={styles.textarea}
                value={line.source}
                onChange={(event) => setDraft((current) => current.map((item) => item.id === line.id ? { ...item, source: event.target.value } : item))}
                aria-label={`Câu ${line.id}`}
                spellCheck
              />
            </label>
          ))}
        </div>

        {error && <p className={styles.validation} role="alert">{error}</p>}
        <footer className={styles.footer}>
          <button className={styles.cancelButton} type="button" onClick={close} disabled={saving}>Hủy</button>
          <button className={styles.saveButton} type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </footer>
      </div>
    </div>
  );
}
