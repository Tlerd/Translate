'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Mic, Search, Trash2 } from 'lucide-react';
import { useLibrary } from './use-library';
import {
  FOLDER_NONE,
  LIBRARY_VIEWS,
  groupByDay,
  listLanguagePairs,
  queryLibrary,
  type LibraryFilters,
  type LibraryQuery,
  type LibrarySort,
  type LibraryView as LibraryViewKey,
} from './library-query';
import { languageBadge, viewLabel } from './library-format';
import {
  TRASH_RETENTION_DAYS,
  batchSoftDelete,
  batchUpdateCategory,
  batchUpdateFolder,
  deleteRecordingsPermanently,
  getLibraryFolders,
  purgeExpiredTrash,
  renameRecording,
  restoreRecordingFields,
  restoreRecordings,
  type RecordingFieldSnapshot,
} from '@/storage/recordings';
import { LibraryToolbar, type LibraryFilterPatch } from './library-toolbar';
import { LibraryRow } from './library-row';
import { LibrarySelectionBar } from './library-selection-bar';
import { LibraryToast, type LibraryToastState } from './library-toast';
import { isTextEntry } from './library-menu';
import styles from './library-view.module.css';

const SORT_KEYS: readonly LibrarySort[] = ['newest', 'oldest', 'longest', 'title'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type UrlKey = 'view' | 'folder' | 'q' | 'sort' | 'lang' | 'from' | 'to' | 'audio';

interface LibraryParams {
  view: LibraryViewKey;
  /** '' for every folder, FOLDER_NONE for recordings without a folder, otherwise a folder name. */
  folder: string;
  q: string;
  sort: LibrarySort;
  lang: string;
  from: string;
  to: string;
  audio: boolean;
}

function isView(value: string | null): value is LibraryViewKey {
  return LIBRARY_VIEWS.some((key) => key === value);
}

function isSort(value: string | null): value is LibrarySort {
  return SORT_KEYS.some((key) => key === value);
}

function readDate(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? '';
  return DATE_PATTERN.test(value) ? value : '';
}

function readParams(params: URLSearchParams): LibraryParams {
  const view = params.get('view');
  const sort = params.get('sort');
  return {
    view: isView(view) ? view : 'all',
    folder: params.get('folder') ?? '',
    q: params.get('q') ?? '',
    sort: isSort(sort) ? sort : 'newest',
    lang: params.get('lang') ?? '',
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    audio: params.get('audio') === '1',
  };
}

function buildQuery(params: LibraryParams): LibraryQuery {
  const filters: LibraryFilters = {
    languagePair: params.lang || undefined,
    dateFrom: params.from || undefined,
    dateTo: params.to || undefined,
    hasAudio: params.audio ? true : undefined,
  };
  return {
    view: params.view,
    folder: params.folder === '' ? undefined : params.folder === FOLDER_NONE ? null : params.folder,
    q: params.q,
    sort: params.sort,
    filters,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra.';
}

interface ChangeRequest {
  ids: readonly string[];
  write: (targets: string[]) => Promise<void>;
  /** Builds the toast text from the number of recordings changed; null shows no toast. */
  message: ((count: number) => string) | null;
  clearSelection: boolean;
}

export function LibraryView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { entries, loading } = useLibrary();

  // Trashed recordings older than the retention window are removed once per visit to the library.
  useEffect(() => {
    purgeExpiredTrash().catch((error: unknown) => console.error('Không dọn được thùng rác.', error));
  }, []);

  const [folders, setFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [toast, setToast] = useState<LibraryToastState | null>(null);
  const anchorRef = useRef<string | null>(null);
  const toastSeqRef = useRef(0);

  // URL is the source of truth for view, folder, search, sort and filters.
  const paramsKey = searchParams.toString();
  const paramsRef = useRef(paramsKey);
  useEffect(() => {
    paramsRef.current = paramsKey;
  }, [paramsKey]);

  // A selection only makes sense for the list it was made in.
  useEffect(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, [paramsKey]);

  useEffect(() => {
    let active = true;
    getLibraryFolders()
      .then((list) => {
        if (active) setFolders(list);
      })
      .catch((error: unknown) => console.error('Không tải được danh sách thư mục.', error));
    return () => {
      active = false;
    };
  }, [entries]);

  const params = useMemo(() => readParams(new URLSearchParams(paramsKey)), [paramsKey]);
  const query = useMemo(() => buildQuery(params), [params]);
  const { result, groups, nowMs } = useMemo(() => {
    const now = new Date();
    const queried = queryLibrary(entries, query, now);
    // The trash is grouped by deletion day; every other view by creation day.
    const field = query.view === 'trash' ? 'deletedAt' : 'createdAt';
    return { result: queried, groups: groupByDay(queried.items, now, field), nowMs: now.getTime() };
  }, [entries, query]);
  const trashIds = useMemo(
    () => entries.filter((entry) => entry.recording.deletedAt).map((entry) => entry.recording.id),
    [entries],
  );
  const hasLiveRecordings = useMemo(() => entries.some((entry) => !entry.recording.deletedAt), [entries]);
  const languagePairs = useMemo(() => listLanguagePairs(entries), [entries]);

  const items = result.items;
  // Rows are shown grouped by day, so shift-click ranges follow the displayed order, not the sort order.
  const displayed = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.recording.id, entry] as const)), [entries]);
  const indexById = useMemo(() => new Map(displayed.map((entry, index) => [entry.recording.id, index] as const)), [displayed]);
  const selectableIds = useMemo(
    () => displayed.filter((entry) => entry.recording.state !== 'recording').map((entry) => entry.recording.id),
    [displayed],
  );
  const selectedIds = useMemo(() => selectableIds.filter((id) => selected.has(id)), [selectableIds, selected]);
  const selectedEntries = useMemo(
    () => selectedIds.flatMap((id) => {
      const entry = entryById.get(id);
      return entry ? [entry] : [];
    }),
    [selectedIds, entryById],
  );
  const allStarred = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.recording.category === 'priority');
  const allArchived = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.recording.category === 'archive');

  const folderLabel = params.folder === '' ? 'Tất cả thư mục' : params.folder === FOLDER_NONE ? 'Không thư mục' : params.folder;

  const folderOptions = useMemo(() => {
    const names = [...folders];
    if (params.folder && params.folder !== FOLDER_NONE && !names.includes(params.folder)) names.push(params.folder);
    return [
      { value: '', label: 'Tất cả thư mục' },
      { value: FOLDER_NONE, label: `Không thư mục (${result.uncategorizedCount})` },
      ...names.map((name) => ({ value: name, label: `${name} (${result.folderCounts[name] ?? 0})` })),
    ];
  }, [folders, params.folder, result]);

  const languageOptions = useMemo(() => {
    const options = languagePairs.map((pair) => ({
      key: pair.key,
      label: `${languageBadge(pair.sourceLanguage, pair.targetLanguage)} (${pair.count})`,
    }));
    if (params.lang && !options.some((option) => option.key === params.lang)) {
      const [source = '', target = ''] = params.lang.split('>');
      options.push({ key: params.lang, label: languageBadge(source, target) });
    }
    return options;
  }, [languagePairs, params.lang]);

  const activeFilterCount = [params.lang, params.from, params.to].filter(Boolean).length + (params.audio ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0 || params.q.trim() !== '' || params.folder !== '';

  // ---- URL state -------------------------------------------------------------

  const updateUrl = useCallback(
    (patch: Partial<Record<UrlKey, string | null>>) => {
      const next = new URLSearchParams(paramsRef.current);
      for (const [key, value] of Object.entries(patch) as Array<[UrlKey, string | null | undefined]>) {
        if (value === undefined) continue;
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      // Defaults stay out of the URL so the address stays short.
      if (next.get('view') === 'all') next.delete('view');
      if (next.get('sort') === 'newest') next.delete('sort');
      if (next.get('audio') !== '1') next.delete('audio');
      const queryString = next.toString();
      // Update the ref now so a second change before the navigation commits builds on this one.
      paramsRef.current = queryString;
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const onSearch = useCallback((value: string) => updateUrl({ q: value }), [updateUrl]);
  const onView = useCallback((view: LibraryViewKey) => updateUrl({ view }), [updateUrl]);
  const onFolder = useCallback((value: string) => updateUrl({ folder: value }), [updateUrl]);
  const onSort = useCallback((sort: LibrarySort) => updateUrl({ sort }), [updateUrl]);
  const onFilter = useCallback(
    (patch: LibraryFilterPatch) => {
      const change: Partial<Record<UrlKey, string | null>> = {};
      if (patch.lang !== undefined) change.lang = patch.lang;
      if (patch.from !== undefined) change.from = patch.from;
      if (patch.to !== undefined) change.to = patch.to;
      if (patch.audio !== undefined) change.audio = patch.audio ? '1' : null;
      updateUrl(change);
    },
    [updateUrl],
  );
  const onClearFilters = useCallback(
    () => updateUrl({ lang: null, from: null, to: null, audio: null }),
    [updateUrl],
  );
  const onClearAll = useCallback(
    () => updateUrl({ lang: null, from: null, to: null, audio: null, q: null, folder: null }),
    [updateUrl],
  );

  // ---- Toast and undo -------------------------------------------------------

  const showToast = useCallback((message: string, tone: 'info' | 'error' = 'info', onUndo?: () => void) => {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, tone, onUndo });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const undoSnapshots = useCallback(
    (snapshots: RecordingFieldSnapshot[]) => {
      void restoreRecordingFields(snapshots).then(
        () => showToast('Đã hoàn tác.'),
        (error: unknown) => showToast(`Không hoàn tác được: ${errorText(error)}`, 'error'),
      );
    },
    [showToast],
  );

  // ---- Changes ---------------------------------------------------------------

  // Bulk selections never include a recording in progress (see selectableIds). The single-row
  // menu disables the actions that would hide it, so only harmless field edits reach here.
  const snapshotsFor = useCallback(
    (ids: readonly string[]): RecordingFieldSnapshot[] =>
      ids.flatMap((id) => {
        const entry = entryById.get(id);
        if (!entry) return [];
        const { recording } = entry;
        return [{ id, folder: recording.folder, category: recording.category, deletedAt: recording.deletedAt }];
      }),
    [entryById],
  );

  const runChange = useCallback(
    async ({ ids, write, message, clearSelection }: ChangeRequest) => {
      const snapshots = snapshotsFor(ids);
      if (snapshots.length === 0) return;
      try {
        await write(snapshots.map((snapshot) => snapshot.id));
        if (clearSelection) {
          setSelected(new Set());
          anchorRef.current = null;
        }
        if (message) showToast(message(snapshots.length), 'info', () => undoSnapshots(snapshots));
      } catch (error: unknown) {
        showToast(`Chưa thực hiện được: ${errorText(error)}`, 'error');
      }
    },
    [snapshotsFor, showToast, undoSnapshots],
  );

  const moveRows = useCallback(
    (ids: readonly string[], folder: string | null, clearSelection: boolean) =>
      runChange({
        ids,
        write: (targets) => batchUpdateFolder(targets, folder),
        message: (count) =>
          folder ? `Đã chuyển ${count} buổi tới thư mục "${folder}".` : `Đã bỏ thư mục của ${count} buổi.`,
        clearSelection,
      }),
    [runChange],
  );

  const trashRows = useCallback(
    (ids: readonly string[], clearSelection: boolean) =>
      runChange({
        ids,
        write: (targets) => batchSoftDelete(targets),
        message: (count) => `Đã chuyển ${count} mục vào thùng rác.`,
        clearSelection,
      }),
    [runChange],
  );

  const clearSelectionState = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  // Restores never offer undo: the recordings simply reappear in their views.
  const restoreRows = useCallback(
    async (ids: readonly string[], clearSelection: boolean) => {
      const targets = ids.filter((id) => entryById.has(id));
      if (targets.length === 0) return;
      try {
        await restoreRecordings(targets);
        if (clearSelection) clearSelectionState();
        showToast(`Đã khôi phục ${targets.length} mục`);
      } catch (error: unknown) {
        showToast(`Chưa thực hiện được: ${errorText(error)}`, 'error');
      }
    },
    [entryById, clearSelectionState, showToast],
  );

  // Permanent deletes are irreversible, so they confirm first and never offer undo.
  const purgeRows = useCallback(
    async (ids: readonly string[], confirmText: (count: number) => string, clearSelection: boolean) => {
      const targets = ids.filter((id) => entryById.has(id));
      if (targets.length === 0) return;
      if (!window.confirm(confirmText(targets.length))) return;
      try {
        await deleteRecordingsPermanently(targets);
        if (clearSelection) clearSelectionState();
        showToast(`Đã xóa vĩnh viễn ${targets.length} mục`);
      } catch (error: unknown) {
        showToast(`Chưa thực hiện được: ${errorText(error)}`, 'error');
      }
    },
    [entryById, clearSelectionState, showToast],
  );

  const archiveRows = useCallback(
    (ids: readonly string[], archived: boolean, clearSelection: boolean) =>
      runChange({
        ids,
        write: (targets) => batchUpdateCategory(targets, archived ? 'archive' : 'inbox'),
        message: (count) => (archived ? `Đã lưu trữ ${count} buổi.` : `Đã bỏ lưu trữ ${count} buổi.`),
        clearSelection,
      }),
    [runChange],
  );

  const starRows = useCallback(
    (ids: readonly string[], starred: boolean, announce: boolean) =>
      runChange({
        ids,
        write: (targets) => batchUpdateCategory(targets, starred ? 'priority' : 'inbox'),
        message: announce ? (count) => (starred ? `Đã gắn sao ${count} buổi.` : `Đã bỏ sao ${count} buổi.`) : null,
        clearSelection: false,
      }),
    [runChange],
  );

  const renameOne = useCallback(
    async (id: string, title: string) => {
      try {
        await renameRecording(id, title);
      } catch (error: unknown) {
        showToast(`Không đổi được tên: ${errorText(error)}`, 'error');
      }
    },
    [showToast],
  );

  const handleToggleStar = useCallback(
    (id: string) => {
      const entry = entryById.get(id);
      if (entry) void starRows([id], entry.recording.category !== 'priority', false);
    },
    [entryById, starRows],
  );

  const handleToggleArchive = useCallback(
    (id: string) => {
      const entry = entryById.get(id);
      if (entry) void archiveRows([id], entry.recording.category !== 'archive', false);
    },
    [entryById, archiveRows],
  );

  const handleTrash = useCallback((id: string) => void trashRows([id], false), [trashRows]);
  const handleRestore = useCallback((id: string) => void restoreRows([id], false), [restoreRows]);
  const handleDeleteForever = useCallback(
    (id: string) => void purgeRows([id], (count) => `Xóa vĩnh viễn ${count} mục? Không thể hoàn tác.`, false),
    [purgeRows],
  );
  const onEmptyTrash = useCallback(
    () => void purgeRows(trashIds, (count) => `Xóa vĩnh viễn tất cả ${count} mục trong thùng rác?`, false),
    [purgeRows, trashIds],
  );
  const handleMove = useCallback((id: string, folder: string | null) => void moveRows([id], folder, false), [moveRows]);

  // ---- Selection -------------------------------------------------------------

  const handleSelect = useCallback(
    (id: string, range: boolean) => {
      // Read the anchor before the state update: updater functions may run later.
      const anchor = anchorRef.current;
      const anchorIndex = anchor === null ? undefined : indexById.get(anchor);
      const targetIndex = indexById.get(id);
      anchorRef.current = id;
      setSelected((previous) => {
        const next = new Set(previous);
        if (range && anchorIndex !== undefined && targetIndex !== undefined) {
          const enable = !previous.has(id);
          const from = Math.min(anchorIndex, targetIndex);
          const to = Math.max(anchorIndex, targetIndex);
          for (let index = from; index <= to; index += 1) {
            const entry = displayed[index];
            if (!entry || entry.recording.state === 'recording') continue;
            if (enable) next.add(entry.recording.id);
            else next.delete(entry.recording.id);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [indexById, displayed],
  );

  const selectAllVisible = useCallback(() => setSelected(new Set(selectableIds)), [selectableIds]);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
    if (isTextEntry(event.target)) return;
    event.preventDefault();
    selectAllVisible();
  };

  // ---- Render ----------------------------------------------------------------

  const renderBody = () => {
    if (loading) {
      return (
        <div className={styles.skeletonList} aria-busy="true" aria-label="Đang tải thư viện">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className={styles.skeletonRow} />
          ))}
        </div>
      );
    }

    if (items.length === 0) {
      if (params.view === 'trash' && !hasActiveFilters) {
        return (
          <div className={styles.empty}>
            <Trash2 size={36} aria-hidden="true" className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Thùng rác trống</p>
            <p className={styles.emptyText}>Buổi bị xóa sẽ nằm ở đây trong {TRASH_RETENTION_DAYS} ngày.</p>
          </div>
        );
      }
      if (params.view !== 'trash' && !hasLiveRecordings) {
        return (
          <div className={styles.empty}>
            <Mic size={36} aria-hidden="true" className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Chưa có buổi ghi nào</p>
            <p className={styles.emptyText}>Ghi âm buổi đầu tiên để bắt đầu xây dựng thư viện.</p>
            <Link href="/new/source/record" className={styles.primaryLink}>
              Ghi âm mới
            </Link>
          </div>
        );
      }
      return (
        <div className={styles.empty}>
          <Search size={36} aria-hidden="true" className={styles.emptyIcon} />
          {hasActiveFilters ? (
            <>
              <p className={styles.emptyTitle}>Không tìm thấy buổi nào</p>
              <p className={styles.emptyText}>Thử đổi từ khóa, thư mục hoặc bộ lọc.</p>
              <button type="button" className={styles.ghostButton} onClick={onClearAll}>
                Xóa bộ lọc
              </button>
            </>
          ) : (
            <>
              <p className={styles.emptyTitle}>Không có buổi nào</p>
              <p className={styles.emptyText}>Mục &quot;{viewLabel(params.view)}&quot; chưa có buổi nào.</p>
            </>
          )}
        </div>
      );
    }

    return (
      <>
        <div className={styles.tableHead} aria-hidden="true">
          <span className={styles.headLead} />
          <span>Tiêu đề</span>
          <div className={styles.rowCols}>
            <span className={styles.colLang}>Ngôn ngữ</span>
            <span className={styles.colDuration}>Độ dài</span>
            <span className={styles.colTime}>{params.view === 'trash' ? 'Còn lại' : 'Thời điểm'}</span>
            <span className={styles.colFolder}>Thư mục</span>
            <span className={styles.colStatus}>Trạng thái</span>
          </div>
          <span className={styles.headLead} />
        </div>
        {groups.map((group) => {
          const showDay = group.key === 'week' || group.key === 'older';
          return (
            <section key={group.key} className={styles.group} aria-labelledby={`library-group-${group.key}`}>
              <h2 id={`library-group-${group.key}`} className={styles.groupTitle}>
                {group.label}
                <span className={styles.groupCount}>{group.items.length}</span>
              </h2>
              <ul className={styles.list}>
                {group.items.map((entry) => (
                  <li key={entry.recording.id}>
                    <LibraryRow
                      entry={entry}
                      showDay={showDay}
                      selected={selected.has(entry.recording.id)}
                      folders={folders}
                      onSelect={handleSelect}
                      onRename={renameOne}
                      onToggleStar={handleToggleStar}
                      onToggleArchive={handleToggleArchive}
                      onMove={handleMove}
                      onTrash={handleTrash}
                      trashNow={params.view === 'trash' ? nowMs : undefined}
                      onRestore={handleRestore}
                      onDeleteForever={handleDeleteForever}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </>
    );
  };

  return (
    <div className={styles.page}>
      <LibraryToolbar
        view={params.view}
        folderLabel={folderLabel}
        counts={result.counts}
        folderValue={params.folder}
        folderOptions={folderOptions}
        search={params.q}
        onSearch={onSearch}
        onView={onView}
        onFolder={onFolder}
        sort={params.sort}
        onSort={onSort}
        languageValue={params.lang}
        languageOptions={languageOptions}
        dateFrom={params.from}
        dateTo={params.to}
        audioOnly={params.audio}
        onFilter={onFilter}
        onClearFilters={onClearFilters}
        activeFilterCount={activeFilterCount}
      />

      {params.view === 'trash' ? (
        <div className={styles.trashNote}>
          <p className={styles.trashNoteText}>Mục trong thùng rác sẽ tự động xóa sau {TRASH_RETENTION_DAYS} ngày.</p>
          {trashIds.length > 0 ? (
            <button type="button" className={styles.trashPurge} onClick={onEmptyTrash}>
              <Trash2 size={14} aria-hidden="true" />
              Dọn thùng rác
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.listWrap} onKeyDown={onListKeyDown}>
        {renderBody()}
      </div>

      {selectedIds.length > 0 ? (
        <LibrarySelectionBar
          selectedCount={selectedIds.length}
          visibleCount={selectableIds.length}
          folders={folders}
          allStarred={allStarred}
          allArchived={allArchived}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onMove={(folder) => void moveRows(selectedIds, folder, true)}
          onToggleStar={() => void starRows(selectedIds, !allStarred, true)}
          onToggleArchive={() => void archiveRows(selectedIds, !allArchived, true)}
          onTrash={() => void trashRows(selectedIds, true)}
          trash={params.view === 'trash'}
          onRestore={() => void restoreRows(selectedIds, true)}
          onDeleteForever={() =>
            void purgeRows(selectedIds, (count) => `Xóa vĩnh viễn ${count} mục? Không thể hoàn tác.`, true)
          }
        />
      ) : null}

      <LibraryToast toast={toast} raised={selectedIds.length > 0} onDismiss={dismissToast} />
    </div>
  );
}
