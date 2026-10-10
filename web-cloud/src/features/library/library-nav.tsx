'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  BarChart3,
  Check,
  Clock,
  CloudOff,
  FileText,
  Folder,
  FolderPlus,
  Library,
  Mic,
  Pencil,
  PanelLeft,
  Plus,
  Radio,
  Settings,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  getCustomFolders,
  getLibraryFolders,
  saveCustomFolders,
  deleteCustomFolder,
  renameCustomFolder,
} from '@/storage/recordings';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { useLibrary } from './use-library';
import { queryLibrary, FOLDER_NONE, type LibraryView } from './library-query';
import { viewLabel } from './library-format';
import { buildLibraryHref, normalizeFolderName, parseNavSelection, type FolderNameError } from './library-nav-model';
import styles from './library-nav.module.css';

export interface LibraryNavProps {
  onCloseMobile?: () => void;
  onToggleSidebar?: () => void;
}

const NAV_VIEWS: ReadonlyArray<{ view: LibraryView; icon: LucideIcon }> = [
  { view: 'all', icon: Library },
  { view: 'starred', icon: Star },
  { view: 'recent', icon: Clock },
  { view: 'unsummarized', icon: FileText },
  { view: 'unsynced', icon: CloudOff },
  { view: 'archived', icon: Archive },
  { view: 'recording', icon: Mic },
  { view: 'trash', icon: Trash2 },
];

const FOLDER_ERROR_TEXT: Record<FolderNameError, string> = {
  empty: 'Tên thư mục không được để trống.',
  too_long: 'Tên thư mục tối đa 120 ký tự.',
  duplicate: 'Thư mục này đã tồn tại.',
  reserved: 'Tên này được dùng riêng cho mục Chưa phân loại.',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sidebar navigator for the library: collections only (views and folders), never individual
 * recordings. Every list is reached through /library?… links, so the library screen owns the content.
 */
export function LibraryNav({ onCloseMobile, onToggleSidebar }: LibraryNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // useLibrary reloads on its own (liveQuery and the sync event), so no polling is needed here.
  const { entries } = useLibrary();

  const [folders, setFolders] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const selection = useMemo(() => parseNavSelection(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onLibrary = pathname === '/library';
  const { counts, folderCounts, uncategorizedCount } = useMemo(
    () => queryLibrary(entries, { view: 'all' }, new Date()),
    [entries],
  );

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await getLibraryFolders());
    } catch (error: unknown) {
      console.error('Không tải được danh sách thư mục.', error);
    }
  }, []);

  // Folders can come from custom storage or from recordings, so they are reloaded whenever the library changes.
  useEffect(() => {
    void loadFolders();
  }, [entries, loadFolders]);

  // Close the Thêm mới popover on an outside click.
  useEffect(() => {
    if (!addOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) setAddOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [addOpen]);

  const isViewActive = (view: LibraryView) => onLibrary && selection.folder === '' && selection.view === view;
  const isFolderActive = (folder: string) => onLibrary && selection.folder === folder;

  const closeMobile = () => onCloseMobile?.();

  const startCreate = () => {
    setCreating((open) => !open);
    setCreateDraft('');
    setCreateError(null);
  };

  const cancelCreate = () => {
    setCreating(false);
    setCreateDraft('');
    setCreateError(null);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = normalizeFolderName(createDraft, folders);
    if (!result.ok) {
      setCreateError(FOLDER_ERROR_TEXT[result.reason]);
      return;
    }
    try {
      // Only the stored custom list is written; folders used by recordings already show up through getLibraryFolders.
      const stored = await getCustomFolders();
      await saveCustomFolders([...stored, result.name]);
      cancelCreate();
      await loadFolders();
    } catch (error: unknown) {
      setCreateError(`Không lưu được thư mục. ${errorMessage(error)}`);
    }
  };

  const startRename = (folder: string) => {
    setEditing(folder);
    setEditDraft(folder);
    setEditError(null);
  };

  const cancelRename = () => {
    setEditing(null);
    setEditDraft('');
    setEditError(null);
  };

  const handleRename = async (event: FormEvent<HTMLFormElement>, folder: string) => {
    event.preventDefault();
    // The folder being renamed is not a duplicate of itself, so a case-only change is allowed.
    const result = normalizeFolderName(editDraft, folders.filter((name) => name !== folder));
    if (!result.ok) {
      setEditError(FOLDER_ERROR_TEXT[result.reason]);
      return;
    }
    try {
      if (result.name !== folder) {
        await renameCustomFolder(folder, result.name);
        // Keep the open folder selected under its new name.
        if (onLibrary && selection.folder === folder) router.replace(buildLibraryHref({ folder: result.name }));
        await loadFolders();
      }
      cancelRename();
    } catch (error: unknown) {
      setEditError(`Không đổi được tên. ${errorMessage(error)}`);
    }
  };

  const handleDelete = async (folder: string) => {
    // Deleting a folder only moves its recordings to "Chưa phân loại"; the recordings are kept.
    if (!window.confirm(`Xóa thư mục "${folder}"? Các file ghi âm bên trong sẽ chuyển về Chưa phân loại, không bị xóa.`)) return;
    try {
      await deleteCustomFolder(folder);
      if (onLibrary && selection.folder === folder) router.replace('/library');
      await loadFolders();
    } catch (error: unknown) {
      console.error('Không xóa được thư mục.', error);
    }
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelRename();
    }
  };

  const handleCreateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelCreate();
    }
  };

  const visibleViews = NAV_VIEWS.filter(({ view }) => {
    // Recording and trash are only listed when they have something in them, or when they are the open view.
    if (view === 'recording') return counts.recording > 0 || isViewActive(view);
    return true;
  });

  return (
    <div className={styles.nav}>
      <div className={styles.header}>
        <Link href="/library" onClick={closeMobile} className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true">
            <Radio size={19} color="var(--accent)" />
          </span>
          <span className={styles.brandText}>Máy Dịch</span>
        </Link>

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Thu gọn thanh bên"
            aria-label="Thu gọn thanh bên"
            className={styles.toggle}
          >
            <PanelLeft size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className={styles.actions} ref={addMenuRef}>
        <button
          type="button"
          onClick={() => setAddOpen((open) => !open)}
          aria-expanded={addOpen}
          className={styles.addButton}
        >
          <Plus size={15} color="var(--accent)" aria-hidden="true" />
          <span>Thêm mới</span>
        </button>

        {addOpen && (
          <div className={styles.popover}>
            <button
              type="button"
              className={styles.popoverItem}
              onClick={() => {
                setAddOpen(false);
                router.push('/new/source/record');
                closeMobile();
              }}
            >
              <Mic size={15} color="var(--accent)" aria-hidden="true" />
              <span>Ghi âm trực tiếp</span>
            </button>
          </div>
        )}
      </div>

      <nav className={styles.scroll} aria-label="Thư viện và thư mục">
        <section className={styles.section} aria-labelledby="library-nav-views">
          <h2 id="library-nav-views" className={styles.sectionTitle}>Thư viện</h2>
          <ul className={styles.list}>
            {visibleViews.map(({ view, icon: Icon }) => {
              const active = isViewActive(view);
              // Trash shows its count only when it is not empty.
              const count = view === 'trash' && counts.trash === 0 ? null : counts[view];
              return (
                <li key={view}>
                  <Link
                    href={buildLibraryHref({ view })}
                    onClick={closeMobile}
                    aria-current={active ? 'page' : undefined}
                    className={`${styles.item} ${active ? styles.itemActive : ''} ${view === 'trash' ? styles.itemTrash : ''}`}
                  >
                    <Icon size={16} aria-hidden="true" className={styles.itemIcon} />
                    <span className={styles.itemLabel}>{viewLabel(view)}</span>
                    {count !== null && <span className={styles.itemCount}>{count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="library-nav-folders">
          <div className={styles.sectionHead}>
            <h2 id="library-nav-folders" className={styles.sectionTitle}>Thư mục</h2>
            <button
              type="button"
              onClick={startCreate}
              aria-expanded={creating}
              className={styles.textButton}
              title="Thêm thư mục mới"
            >
              <FolderPlus size={13} aria-hidden="true" />
              <span>+ Thư mục</span>
            </button>
          </div>

          {creating && (
            <form className={styles.inlineForm} onSubmit={(event) => void handleCreate(event)} noValidate>
              <input
                type="text"
                className={styles.input}
                placeholder="Tên thư mục mới…"
                aria-label="Tên thư mục mới"
                aria-invalid={createError ? true : undefined}
                aria-describedby={createError ? 'library-nav-create-error' : undefined}
                value={createDraft}
                onChange={(event) => {
                  setCreateDraft(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={handleCreateKeyDown}
                autoFocus
                maxLength={200}
              />
              <button type="submit" className={styles.iconButton} title="Lưu thư mục" aria-label="Lưu thư mục">
                <Check size={14} color="var(--success)" aria-hidden="true" />
              </button>
              <button type="button" className={styles.iconButton} title="Hủy" aria-label="Hủy tạo thư mục" onClick={cancelCreate}>
                <X size={14} color="var(--danger)" aria-hidden="true" />
              </button>
              {createError && <p id="library-nav-create-error" role="alert" className={styles.error}>{createError}</p>}
            </form>
          )}

          <ul className={styles.list}>
            {folders.map((folder) => {
              const active = isFolderActive(folder);
              if (editing === folder) {
                return (
                  <li key={folder}>
                    <form className={styles.inlineForm} onSubmit={(event) => void handleRename(event, folder)} noValidate>
                      <input
                        type="text"
                        className={styles.input}
                        aria-label={`Tên mới cho thư mục ${folder}`}
                        aria-invalid={editError ? true : undefined}
                        aria-describedby={editError ? 'library-nav-edit-error' : undefined}
                        value={editDraft}
                        onChange={(event) => {
                          setEditDraft(event.target.value);
                          setEditError(null);
                        }}
                        onKeyDown={handleEditKeyDown}
                        autoFocus
                        maxLength={200}
                      />
                      <button type="submit" className={styles.iconButton} title="Lưu" aria-label="Lưu tên thư mục">
                        <Check size={14} color="var(--success)" aria-hidden="true" />
                      </button>
                      <button type="button" className={styles.iconButton} title="Hủy" aria-label="Hủy đổi tên" onClick={cancelRename}>
                        <X size={14} color="var(--danger)" aria-hidden="true" />
                      </button>
                      {editError && <p id="library-nav-edit-error" role="alert" className={styles.error}>{editError}</p>}
                    </form>
                  </li>
                );
              }
              return (
                <li key={folder} className={styles.folderRow}>
                  <Link
                    href={buildLibraryHref({ folder })}
                    onClick={closeMobile}
                    aria-current={active ? 'page' : undefined}
                    title={folder}
                    className={`${styles.item} ${styles.folderLink} ${active ? styles.itemActive : ''}`}
                  >
                    <Folder size={15} color="#f59e0b" aria-hidden="true" className={styles.itemIcon} />
                    <span className={styles.itemLabel}>{folder}</span>
                    <span className={styles.itemCount}>{folderCounts[folder] ?? 0}</span>
                  </Link>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => startRename(folder)}
                      title="Đổi tên thư mục"
                      aria-label={`Đổi tên thư mục ${folder}`}
                    >
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => void handleDelete(folder)}
                      title="Xóa thư mục"
                      aria-label={`Xóa thư mục ${folder}`}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}

            <li>
              <Link
                href={buildLibraryHref({ folder: FOLDER_NONE })}
                onClick={closeMobile}
                aria-current={isFolderActive(FOLDER_NONE) ? 'page' : undefined}
                className={`${styles.item} ${isFolderActive(FOLDER_NONE) ? styles.itemActive : ''}`}
              >
                <Folder size={15} color="var(--text-muted)" aria-hidden="true" className={styles.itemIcon} />
                <span className={styles.itemLabel}>Chưa phân loại</span>
                <span className={styles.itemCount}>{uncategorizedCount}</span>
              </Link>
            </li>
          </ul>
        </section>
      </nav>

      <div className={styles.footer}>
        <CloudSyncStatus />
        <div className={styles.footerLinks}>
          <Link
            href="/settings"
            onClick={closeMobile}
            aria-current={pathname === '/settings' ? 'page' : undefined}
            className={`${styles.footerLink} ${pathname === '/settings' ? styles.footerLinkActive : ''}`}
          >
            <Settings size={15} aria-hidden="true" />
            <span>Cấu hình AI</span>
          </Link>
          <Link
            href="/usage"
            onClick={closeMobile}
            aria-current={pathname === '/usage' ? 'page' : undefined}
            className={`${styles.footerLink} ${pathname === '/usage' ? styles.footerLinkActive : ''}`}
          >
            <BarChart3 size={15} aria-hidden="true" />
            <span>Chi phí</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
