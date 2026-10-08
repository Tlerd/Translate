'use client';

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  RotateCcw,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { LibraryEntry, SyncState } from './library-query';
import { formatClock, formatDay, formatDuration, formatTrashRemaining, languageBadge, trashDaysLeft } from './library-format';
import { FolderMenuItems, focusFirstMenuItem, handleMenuNavigation, useDismissible } from './library-menu';
import { createLongPress, type LongPressController } from './long-press';
import styles from './library-view.module.css';

export interface LibraryRowProps {
  entry: LibraryEntry;
  /** Show the calendar day next to the time (used for the older groups). */
  showDay: boolean;
  selected: boolean;
  /** True while any row is selected. On touch screens a tap then toggles the row instead of opening it. */
  selectionActive: boolean;
  folders: readonly string[];
  onSelect: (id: string, range: boolean) => void;
  /** Touch and pen long press on a row: the row becomes selected. */
  onLongPress: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggleStar: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onMove: (id: string, folder: string | null) => void;
  onTrash: (id: string) => void;
  /** Set only in the trash view: the current time, used for the days-left label. */
  trashNow?: number;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
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

/** Controls inside the row keep their own pointer behaviour, so they never start a long press. */
const PRESS_IGNORED_SELECTOR = 'button, input, [role="menu"]';
/** Clicks on these belong to the control itself; the title link is handled by its own onClick. */
const TAP_IGNORED_SELECTOR = 'a, button, input, [role="menu"]';

function isWithin(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** Evaluated at event time so a device switching input mode is handled correctly. */
function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

function vibrate(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    // Vibration is optional; the selection works without it.
  }
}

export const LibraryRow = memo(function LibraryRow({
  entry,
  showDay,
  selected,
  selectionActive,
  folders,
  onSelect,
  onLongPress,
  onRename,
  onToggleStar,
  onToggleArchive,
  onMove,
  onTrash,
  trashNow,
  onRestore,
  onDeleteForever,
}: LibraryRowProps) {
  const { recording, hasSummary, sync } = entry;
  const { id, title } = recording;
  const inTrash = trashNow !== undefined;
  const isRecording = recording.state === 'recording';
  const isStarred = recording.category === 'priority';
  const isArchived = recording.category === 'archive';
  const href = isRecording ? '/recording' : `/recordings/${encodeURIComponent(id)}`;
  // In the trash the date cell shows the days left instead of the creation time.
  const timeText = trashNow !== undefined
    ? formatTrashRemaining(trashDaysLeft(recording.deletedAt ?? '', trashNow))
    : `${showDay ? `${formatDay(recording.createdAt)} ` : ''}${formatClock(recording.createdAt)}`;

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'main' | 'move'>('main');
  const menuCellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Set when a long press fired; the click after it is swallowed, and the native context menu is blocked.
  const longPressFiredRef = useRef(false);
  const swallowClickRef = useRef(false);
  // A long press fires on a timer, so the callback reads the latest id and handler from a ref.
  const latestRef = useRef({ id, onLongPress });
  useEffect(() => {
    latestRef.current = { id, onLongPress };
  }, [id, onLongPress]);
  const [longPress] = useState<LongPressController>(() =>
    createLongPress({
      onLongPress: () => {
        longPressFiredRef.current = true;
        vibrate();
        const latest = latestRef.current;
        latest.onLongPress(latest.id);
      },
    }),
  );
  useEffect(() => {
    return () => {
      longPress.end();
    };
  }, [longPress]);

  const onRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    swallowClickRef.current = false;
    if (event.pointerType === 'mouse' || isRecording) return;
    if (isWithin(event.target, PRESS_IGNORED_SELECTOR)) return;
    longPressFiredRef.current = false;
    longPress.start(event.clientX, event.clientY);
  };

  const onRowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    longPress.move(event.clientX, event.clientY);
  };

  const onRowPointerUp = () => {
    if (longPress.end()) swallowClickRef.current = true;
  };

  const onRowPointerCancel = () => {
    longPress.end();
  };

  const onRowContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (longPressFiredRef.current) event.preventDefault();
  };

  /** Click handling shared by the title link and the empty parts of the row. */
  const handleTap = (event: ReactMouseEvent<Element>) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      event.preventDefault();
      return;
    }
    if (!selectionActive || !isCoarsePointer()) return;
    event.preventDefault();
    onSelect(id, false);
  };

  const onRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isWithin(event.target, TAP_IGNORED_SELECTOR)) return;
    handleTap(event);
  };

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
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${inTrash ? styles.rowTrashed : ''}`}
      onPointerDown={onRowPointerDown}
      onPointerMove={onRowPointerMove}
      onPointerUp={onRowPointerUp}
      onPointerCancel={onRowPointerCancel}
      onPointerLeave={onRowPointerCancel}
      onClick={onRowClick}
      onContextMenu={onRowContextMenu}
    >
      <div className={styles.rowLead}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selected}
          disabled={isRecording}
          aria-label={`Chọn buổi "${title}"`}
          onChange={(event) => onSelect(id, hasShift(event.nativeEvent))}
        />
        {inTrash ? null : (
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
        )}
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
        ) : inTrash ? (
          // Trashed recordings are not opened from the list; restore them first.
          <span className={styles.rowTitleMuted} title={title}>
            {title || 'Chưa có tiêu đề'}
          </span>
        ) : (
          <Link href={href} className={styles.rowTitleLink} title={title} onClick={handleTap}>
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
            {inTrash ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    closeMenu(true);
                    onRestore(id);
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Khôi phục</span>
                </button>
                <div role="separator" className={styles.menuSeparator} />
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => {
                    closeMenu(true);
                    onDeleteForever(id);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span className={styles.menuItemLabel}>Xóa vĩnh viễn</span>
                </button>
              </>
            ) : panel === 'main' ? (
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
