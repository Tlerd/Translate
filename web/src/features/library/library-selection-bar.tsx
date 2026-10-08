'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Archive, ArchiveRestore, ChevronDown, Star, Trash2, X } from 'lucide-react';
import { FolderMenuItems, focusFirstMenuItem, handleMenuNavigation, useDismissible } from './library-menu';
import styles from './library-view.module.css';

export interface LibrarySelectionBarProps {
  selectedCount: number;
  /** Selectable rows currently on screen. */
  visibleCount: number;
  folders: readonly string[];
  allStarred: boolean;
  allArchived: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onMove: (folder: string | null) => void;
  onToggleStar: () => void;
  onToggleArchive: () => void;
  onTrash: () => void;
}

export function LibrarySelectionBar({
  selectedCount,
  visibleCount,
  folders,
  allStarred,
  allArchived,
  onSelectAll,
  onClear,
  onMove,
  onToggleStar,
  onToggleArchive,
  onTrash,
}: LibrarySelectionBarProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const moveWrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const dismissMove = useCallback(() => setMoveOpen(false), []);
  useDismissible(moveOpen, moveWrapRef, dismissMove);

  useEffect(() => {
    if (moveOpen) focusFirstMenuItem(menuRef.current);
  }, [moveOpen]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setMoveOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setMoveOpen(false);
      return;
    }
    handleMenuNavigation(event);
  };

  const pickFolder = (folder: string | null) => {
    setMoveOpen(false);
    onMove(folder);
  };

  return (
    <div role="region" aria-label="Thao tác với các buổi đã chọn" className={styles.selectionBar}>
      <span className={styles.selectionCount} aria-live="polite">
        Đã chọn {selectedCount}
      </span>
      <button
        type="button"
        className={styles.barButton}
        onClick={onSelectAll}
        disabled={visibleCount === 0 || selectedCount === visibleCount}
      >
        Chọn tất cả (đang hiện {visibleCount})
      </button>

      <div className={styles.moveWrap} ref={moveWrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.barButton}
          aria-haspopup="menu"
          aria-expanded={moveOpen}
          onClick={() => setMoveOpen((open) => !open)}
        >
          Di chuyển
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {moveOpen ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Chuyển các buổi đã chọn tới thư mục"
            className={styles.menuUp}
            onKeyDown={onMenuKeyDown}
          >
            <FolderMenuItems
              folders={folders}
              current={undefined}
              onPick={pickFolder}
              onCreate={(name) => pickFolder(name)}
            />
          </div>
        ) : null}
      </div>

      <button type="button" className={styles.barButton} onClick={onToggleStar}>
        <Star size={14} aria-hidden="true" fill={allStarred ? 'currentColor' : 'none'} />
        {allStarred ? 'Bỏ sao' : 'Gắn sao'}
      </button>
      <button type="button" className={styles.barButton} onClick={onToggleArchive}>
        {allArchived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
        {allArchived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
      </button>
      <button type="button" className={`${styles.barButton} ${styles.barButtonDanger}`} onClick={onTrash}>
        <Trash2 size={14} aria-hidden="true" />
        Xóa
      </button>
      <button type="button" className={styles.barButton} onClick={onClear}>
        <X size={14} aria-hidden="true" />
        Bỏ chọn
      </button>
    </div>
  );
}
