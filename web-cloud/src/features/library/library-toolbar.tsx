'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import Link from 'next/link';
import { Plus, Search, Trash2, X } from 'lucide-react';
import type { LibrarySort, LibraryView as LibraryViewKey } from './library-query';
import { viewLabel } from './library-format';
import { isTextEntry } from './library-menu';
import styles from './library-view.module.css';

const VIEW_ORDER: readonly LibraryViewKey[] = [
  'all',
  'recent',
  'starred',
  'unsummarized',
  'unsynced',
  'recording',
  'archived',
  'trash',
];

const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySort; label: string }> = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
  { value: 'longest', label: 'Dài nhất' },
  { value: 'title', label: 'Theo tên' },
];

const SEARCH_DEBOUNCE_MS = 200;

export interface LibraryFilterPatch {
  lang?: string;
  from?: string;
  to?: string;
  audio?: boolean;
}

export interface LibraryToolbarProps {
  /** The library view owns this ref so it can focus the search field (mobile search tab). */
  searchInputRef: RefObject<HTMLInputElement | null>;
  view: LibraryViewKey;
  folderLabel: string;
  counts: Record<LibraryViewKey, number>;
  /** '' for every folder, '_none' for recordings without a folder, otherwise a folder name. */
  folderValue: string;
  folderOptions: ReadonlyArray<{ value: string; label: string }>;
  search: string;
  onSearch: (value: string) => void;
  onView: (view: LibraryViewKey) => void;
  onFolder: (value: string) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  languageValue: string;
  languageOptions: ReadonlyArray<{ key: string; label: string }>;
  dateFrom: string;
  dateTo: string;
  audioOnly: boolean;
  onFilter: (patch: LibraryFilterPatch) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
}

export function LibraryToolbar({
  searchInputRef,
  view,
  folderLabel,
  counts,
  folderValue,
  folderOptions,
  search,
  onSearch,
  onView,
  onFolder,
  sort,
  onSort,
  languageValue,
  languageOptions,
  dateFrom,
  dateTo,
  audioOnly,
  onFilter,
  onClearFilters,
  activeFilterCount,
}: LibraryToolbarProps) {
  // Open at start when a filter is already on, so the active state is visible.
  const [filtersOpen, setFiltersOpen] = useState(activeFilterCount > 0);
  const [draft, setDraft] = useState(search);
  // The last search value this toolbar wrote to the URL. Differences from it mean
  // the URL changed from outside (back/forward, clearing filters), so the draft follows.
  const pushedRef = useRef(search);

  useEffect(() => {
    if (search === pushedRef.current) return;
    pushedRef.current = search;
    setDraft(search);
  }, [search]);

  useEffect(() => {
    if (draft === pushedRef.current) return;
    const timer = window.setTimeout(() => {
      pushedRef.current = draft;
      onSearch(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, onSearch]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInputRef]);

  const clearSearch = () => {
    setDraft('');
    pushedRef.current = '';
    onSearch('');
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
    }
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarHead}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>Thư viện</h1>
          <p className={styles.crumb}>
            {viewLabel(view)} · {folderLabel}
          </p>
        </div>
        <Link href="/new/source/record" className={styles.primaryLink}>
          <Plus size={16} aria-hidden="true" />
          Ghi âm mới
        </Link>
      </div>

      <div className={styles.chips} role="group" aria-label="Chế độ xem">
        {VIEW_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={styles.chip}
            aria-pressed={view === key}
            onClick={() => onView(key)}
          >
            {key === 'trash' ? <Trash2 size={14} aria-hidden="true" /> : null}
            {viewLabel(key)}
            {key === 'trash' && counts[key] === 0 ? null : <span className={styles.chipCount}>{counts[key]}</span>}
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.searchWrap}>
          <Search size={16} aria-hidden="true" className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            placeholder="Tìm theo tiêu đề…"
            aria-label="Tìm theo tiêu đề"
            value={draft}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {draft ? (
            <button type="button" className={styles.searchClear} aria-label="Xóa tìm kiếm" onClick={clearSearch}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <select
          className={styles.select}
          aria-label="Thư mục"
          value={folderValue}
          onChange={(event) => onFolder(event.target.value)}
        >
          {folderOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          aria-label="Sắp xếp"
          value={sort}
          onChange={(event) => onSort(event.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <details
        className={styles.filters}
        open={filtersOpen}
        onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
      >
        <summary className={styles.filtersSummary}>
          Bộ lọc
          {activeFilterCount > 0 ? (
            <>
              <span className={styles.filterDot} aria-hidden="true" />
              <span className={styles.srOnly}>(đang bật {activeFilterCount})</span>
            </>
          ) : null}
        </summary>
        <div className={styles.filtersBody}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Cặp ngôn ngữ</span>
            <select
              className={styles.select}
              value={languageValue}
              onChange={(event) => onFilter({ lang: event.target.value })}
            >
              <option value="">Mọi cặp ngôn ngữ</option>
              {languageOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Từ ngày</span>
            <input
              type="date"
              className={styles.select}
              value={dateFrom}
              onChange={(event) => onFilter({ from: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Đến ngày</span>
            <input
              type="date"
              className={styles.select}
              value={dateTo}
              onChange={(event) => onFilter({ to: event.target.value })}
            />
          </label>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(event) => onFilter({ audio: event.target.checked })}
            />
            Chỉ buổi có audio
          </label>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={activeFilterCount === 0}
            onClick={onClearFilters}
          >
            Xóa bộ lọc
          </button>
        </div>
      </details>
    </div>
  );
}
