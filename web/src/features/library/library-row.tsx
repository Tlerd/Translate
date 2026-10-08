'use client';

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Cloud,
  Folder,
  FolderInput,
  Loader2,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { LibraryEntry, SyncState } from './library-query';
import { formatClock, formatDay, formatDuration, languageBadge } from './library-format';
import { FolderMenuItems, focusFirstMenuItem, handleMenuNavigation, useDismissible } from './library-menu';
import styles from './library-view.module.css';

export interface LibraryRowProps {
  entry: LibraryEntry;
  /** Show the calendar day next to the time (used for the older groups). */
  showDay: boolean;
  selected: boolean;
  folders: readonly string[];
  onSelect: (id: string, range: boolean) => void;
  onRename: (id: string, title: string) => void;
  onToggleStar: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onMove: (id: string, folder: string | null) => void;
  onTrash: (id: string) => void;
}

type SyncLabelState = Exclude<SyncState, 'local'>;

const SYNC_LABELS: Record<SyncLabelState, string> = {
  synced: 'Đã đồng bộ lên đám mây',
  pending: 'Đang chờ đồng bộ',
  error: 'Đồng bộ lỗi',
};

function hasShift(event: Event): boolean {
  return event instanceof MouseEvent && event.shiftKey;
}

export const LibraryRow = memo(function LibraryRow({
  entry,
  showDay,
  selected,
  folders,
  onSelect,
  onRename,
  onToggleStar,
  onToggleArchive,
  onMove,
  onTrash,
}: LibraryRowProps) {
  const { recording, hasSummary, sync } = entry;
  const { id, title } = recording;
  const isRecording = recording.state === 'recording';
  const isStarred = recording.category === 'priority';
  const isArchived = recording.category === 'archive';
  const href = isRecording ? '/recording' : `/recordings/${encodeURIComponent(id)}`;
  const timeText = `${showDay ? `${formatDay(recording.createdAt)} ` : ''}${formatClock(recording.createdAt)}`;

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'main' | 'move'>('main');
  const menuCellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const dismissMenu = useCallback(() => setMenuOpen(false), []);
  useDismissible(menuOpen, menuCellRef, dismissMenu);

  useEffect(() => {
    if (menuOpen) focusFirstMenuItem(menuRef.current);
  }, [menuOpen, panel]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    handleMenuNavigation(event);
  };

  const startRename = () => {
    setMenuOpen(false);
    setRenaming(true);
  };

  const renderSync = () => {
    if (sync === 'local') return null;
    const Icon: LucideIcon = sync === 'synced' ? Cloud : sync === 'pending' ? Loader2 : AlertTriangle;
    const className = sync === 'synced' ? styles.syncSynced : sync === 'pending' ? styles.syncPending : styles.syncError;
    return (
      <span role="img" aria-label={SYNC_LABELS[sync]} title={SYNC_LABELS[sync]} className={`${styles.syncBadge} ${className}`}>
        <Icon size={14} aria-hidden="true" className={sync === 'pending' ? styles.spin : undefined} />
      </span>
    );
  };

  return (
    <div className={`${styles.row} ${selected ? styles.rowSelected : ''}`}>
      <div className={styles.rowLead}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selected}
          disabled={isRecording}
          aria-label={`Chọn buổi "${title}"`}
          onChange={(event) => onSelect(id, hasShift(event.nativeEvent))}
        />
        <button
          type="button"
          className={`${styles.iconButton} ${isStarred ? styles.starOn : ''}`}
          aria-pressed={isStarred}
          aria-label={isStarred ? 'Bỏ gắn sao' : 'Gắn sao'}
          title={isStarred ? 'Bỏ gắn sao' : 'Gắn sao'}
          onClick={() => onToggleStar(id)}
        >
          <Star size={16} fill={isStarred ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.rowTitle}>
        {renaming ? (
          <RenameField
            initial={title}
            onCommit={(next) => {
              setRenaming(false);
              if (next !== title) onRename(id, next);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <Link href={href} className={styles.rowTitleLink} title={title}>
            {title || 'Chưa có tiêu đề'}
          </Link>
        )}
      </div>

      <div className={styles.rowCols}>
        <span className={styles.colLang}>{languageBadge(recording.sourceLanguage, recording.targetLanguage)}</span>
        <span className={styles.colDuration}>{formatDuration(recording.durationMs)}</span>
        <span className={styles.colTime}>{timeText}</span>
        <span className={styles.colFolder}>
          {recording.folder ? (
            <span className={styles.folderChip}>
              <Folder size={12} aria-hidden="true" />
              {recording.folder}
            </span>
          ) : null}
        </span>
        <span className={styles.colStatus}>
          {hasSummary ? (
            <span className={styles.summaryBadge}>
              <Check size={12} aria-hidden="true" />
              Đã tóm tắt
            </span>
          ) : null}
          {isRecording ? (
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} aria-hidden="true" />
              Đang ghi
            </span>
          ) : null}
          {renderSync()}
        </span>
      </div>

      <div className={styles.rowMenuCell} ref={menuCellRef}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.iconButton}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Thao tác cho "${title}"`}
          title="Thao tác"
          onClick={() => {
            setPanel('main');
            setMenuOpen((open) => !open);
          }}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Thao tác cho "${title}"`}
            className={styles.menu}
            onKeyDown={onMenuKeyDown}
          >
            {panel === 'main' ? (
              <>
                <button type="button" role="menuitem" className={styles.menuItem} onClick={startRename}>
                  <Pencil size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Đổi tên</span>
                </button>
                <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setPanel('move')}>
                  <FolderInput size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Di chuyển tới thư mục…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    closeMenu(true);
                    onToggleStar(id);
                  }}
                >
                  <Star size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>{isStarred ? 'Bỏ sao' : 'Gắn sao'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={isRecording}
                  onClick={() => {
                    closeMenu(true);
                    onToggleArchive(id);
                  }}
                >
                  {isArchived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                  <span className={styles.menuItemLabel}>{isArchived ? 'Bỏ lưu trữ' : 'Lưu trữ'}</span>
                </button>
                <div role="separator" className={styles.menuSeparator} />
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  disabled={isRecording}
                  onClick={() => {
                    closeMenu(true);
                    onTrash(id);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Xóa</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setPanel('main')}>
                  <ChevronLeft size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Quay lại</span>
                </button>
                <p className={styles.menuHeading}>Chuyển tới thư mục</p>
                <FolderMenuItems
                  folders={folders}
                  current={recording.folder ? recording.folder : null}
                  onPick={(folder) => {
                    closeMenu(true);
                    onMove(id, folder);
                  }}
                  onCreate={(name) => {
                    closeMenu(true);
                    onMove(id, name);
                  }}
                />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

interface RenameFieldProps {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Inline title editor: Enter saves, Escape cancels, leaving the field saves. */
function RenameField({ initial, onCommit, onCancel }: RenameFieldProps) {
  const [value, setValue] = useState(initial);
  // Enter, Escape and blur can all fire for one edit; only the first one counts.
  const settled = useRef(false);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const clean = value.trim();
    if (commit && clean) onCommit(clean);
    else onCancel();
  };

  return (
    <input
      type="text"
      className={styles.renameInput}
      aria-label="Tên buổi ghi"
      value={value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          settle(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
      onBlur={() => settle(true)}
    />
  );
}
