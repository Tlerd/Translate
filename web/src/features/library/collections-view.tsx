'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Star,
  Archive,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
  FolderInput,
  Check,
  X,
  AudioLines,
} from 'lucide-react';
import {
  listRecordings,
  getCustomFolders,
  saveCustomFolders,
  updateRecordingCategory,
  batchUpdateFolder,
  batchSoftDelete,
  renameRecording,
  softDeleteRecording,
} from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import type { RecordingItem } from '@/shared/recording';
import styles from './collections.module.css';

function formatDisplayDate(iso: string) {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return iso;
  }
}

export function CollectionsView() {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<'inbox' | 'priority' | 'archive'>('inbox');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Folder creation state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Item dropdown & edit states
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [movingFolderIds, setMovingFolderIds] = useState<string[] | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [items, folders] = await Promise.all([
        listRecordings(200, 0, false),
        getCustomFolders(),
      ]);
      setRecordings(items);
      setCustomFolders(folders);
    } catch (err) {
      console.error('Lỗi tải dữ liệu thư viện:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const reload = () => { void loadData(); };
    window.addEventListener(dataEvent, reload);
    return () => window.removeEventListener(dataEvent, reload);
  }, [loadData]);

  // Click outside menu to close
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    if (activeMenuId) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [activeMenuId]);

  // Filtering
  const filtered = recordings.filter((r) => {
    const itemCat = r.category || 'inbox';
    if (itemCat !== activeCategory) return false;
    if (selectedFolder !== null && r.folder !== selectedFolder) return false;
    return true;
  });

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setShowNewFolder(false);
      return;
    }
    if (!customFolders.includes(name)) {
      const next = [...customFolders, name];
      await saveCustomFolders(next);
      setCustomFolders(next);
      setSelectedFolder(name);
    }
    setNewFolderName('');
    setShowNewFolder(false);
  };

  // Multi-select handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Xóa ${selectedIds.size} bản ghi đã chọn vào Thùng rác?`)) {
      await batchSoftDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      await loadData();
    }
  };

  const handleBatchMoveFolder = async (folderName: string | null) => {
    if (!movingFolderIds || movingFolderIds.length === 0) return;
    await batchUpdateFolder(movingFolderIds, folderName);
    setMovingFolderIds(null);
    setSelectedIds(new Set());
    await loadData();
  };

  // Single Item actions
  const handleSaveRename = async (id: string) => {
    const clean = editTitle.trim();
    if (clean) {
      await renameRecording(id, clean);
      await loadData();
    }
    setEditingId(null);
  };

  const handleDeleteItem = async (rec: RecordingItem) => {
    if (window.confirm(`Chuyển "${rec.title}" vào Thùng rác?`)) {
      await softDeleteRecording(rec.id);
      setActiveMenuId(null);
      await loadData();
    }
  };

  const handleChangeCategory = async (id: string, cat: 'inbox' | 'priority' | 'archive') => {
    await updateRecordingCategory(id, cat);
    setActiveMenuId(null);
    await loadData();
  };

  return (
    <div className={styles.container}>
      {/* Title Header */}
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Thư viện</h1>
      </div>

      {/* Category Tabs: Hộp thư đến, Ưu tiên, Lưu trữ */}
      <div className={styles.tabsRow} role="tablist" aria-label="Phân loại bản ghi">
        <button
          type="button"
          className={`${styles.categoryTab} ${activeCategory === 'inbox' ? styles.categoryTabActive : ''}`}
          onClick={() => { setActiveCategory('inbox'); setSelectedIds(new Set()); }}
        >
          <Inbox size={15} />
          <span>Hộp thư đến</span>
        </button>

        <button
          type="button"
          className={`${styles.categoryTab} ${activeCategory === 'priority' ? styles.categoryTabActive : ''}`}
          onClick={() => { setActiveCategory('priority'); setSelectedIds(new Set()); }}
        >
          <Star size={15} />
          <span>Ưu tiên</span>
        </button>

        <button
          type="button"
          className={`${styles.categoryTab} ${activeCategory === 'archive' ? styles.categoryTabActive : ''}`}
          onClick={() => { setActiveCategory('archive'); setSelectedIds(new Set()); }}
        >
          <Archive size={15} />
          <span>Lưu trữ</span>
        </button>
      </div>

      {/* Google Drive style Folders Organization */}
      <div className={styles.foldersSection}>
        <div className={styles.foldersHeader}>Thư mục</div>
        <div className={styles.foldersRow}>
          <button
            type="button"
            className={`${styles.folderChip} ${selectedFolder === null ? styles.folderChipActive : ''}`}
            onClick={() => setSelectedFolder(null)}
          >
            <Folder size={14} />
            <span>Tất cả</span>
          </button>

          {customFolders.map((f) => {
            const count = recordings.filter((r) => r.folder === f).length;
            return (
              <button
                key={f}
                type="button"
                className={`${styles.folderChip} ${selectedFolder === f ? styles.folderChipActive : ''}`}
                onClick={() => setSelectedFolder(f)}
              >
                <Folder size={14} color="#f59e0b" />
                <span>{f}</span>
                <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}

          {showNewFolder ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="text"
                placeholder="Tên thư mục mới..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
                autoFocus
                style={{
                  height: 28,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--accent)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                <Check size={14} color="var(--success)" />
              </button>
              <button
                type="button"
                onClick={() => setShowNewFolder(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} color="var(--danger)" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.addFolderBtn}
              onClick={() => setShowNewFolder(true)}
              title="Thêm thư mục mới"
            >
              <FolderPlus size={14} />
              <span>+ Thư mục mới</span>
            </button>
          )}
        </div>
      </div>

      {/* Desktop Multi-Select Action Bar (hidden on mobile via CSS) */}
      {selectedIds.size > 0 && (
        <div className={styles.multiActionBar}>
          <span className={styles.multiActionText}>Đã chọn {selectedIds.size}</span>
          <button
            type="button"
            className={styles.multiActionBtn}
            onClick={handleSelectAll}
          >
            {selectedIds.size === filtered.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
          <button
            type="button"
            className={styles.multiActionBtn}
            onClick={() => setMovingFolderIds(Array.from(selectedIds))}
          >
            <FolderInput size={14} />
            <span>Di chuyển bộ sưu tập</span>
          </button>
          <button
            type="button"
            className={`${styles.multiActionBtn} ${styles.multiActionBtnDanger}`}
            onClick={handleBatchDelete}
          >
            <Trash2 size={14} />
            <span>Xóa</span>
          </button>
        </div>
      )}

      {/* Move Folder Modal */}
      {movingFolderIds && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
          }}
          onClick={() => setMovingFolderIds(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              maxWidth: 360,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Chọn thư mục đích</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => void handleBatchMoveFolder(null)}
              >
                <Folder size={14} />
                <span>Chưa phân loại (Bỏ khỏi thư mục)</span>
              </button>
              {customFolders.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => void handleBatchMoveFolder(f)}
                >
                  <Folder size={14} color="#f59e0b" />
                  <span>{f}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.multiActionBtn}
              onClick={() => setMovingFolderIds(null)}
              style={{ marginTop: 8 }}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {/* Files Items List */}
      <div className={styles.itemsList}>
        {filtered.map((rec) => {
          const isSelected = selectedIds.has(rec.id);
          const isEditingThis = editingId === rec.id;
          const isMenuOpen = activeMenuId === rec.id;

          return (
            <div key={rec.id} className={styles.itemCard}>
              {/* Checkbox (Desktop only) */}
              <div className={styles.checkboxCol}>
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={isSelected}
                  onChange={() => handleToggleSelect(rec.id)}
                  aria-label={`Chọn bản ghi ${rec.title}`}
                />
              </div>

              {/* Big Preview Thumbnail */}
              <Link href={`/recordings/${rec.id}`} className={styles.previewThumb}>
                <span>Máy Dịch</span>
              </Link>

              {/* Details Column */}
              <div className={styles.contentCol}>
                <div className={styles.itemAudioMeta}>
                  <AudioLines size={13} color="var(--accent)" />
                  <span>Ghi âm</span>
                  {rec.folder && (
                    <>
                      <span>•</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{rec.folder}</span>
                    </>
                  )}
                </div>

                {isEditingThis ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveRename(rec.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid var(--accent)',
                        backgroundColor: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        flex: 1,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveRename(rec.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                    >
                      <Check size={16} color="var(--success)" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                    >
                      <X size={16} color="var(--danger)" />
                    </button>
                  </div>
                ) : (
                  <Link href={`/recordings/${rec.id}`} className={styles.itemTitle}>
                    {rec.title}
                  </Link>
                )}

                <span className={styles.itemDate}>{formatDisplayDate(rec.createdAt)}</span>

                {/* Sub Tag Pills */}
                <div className={styles.itemPillsRow}>
                  <button
                    type="button"
                    className={`${styles.tagPill} ${(!rec.category || rec.category === 'inbox') ? styles.tagPillActive : ''}`}
                    onClick={() => void handleChangeCategory(rec.id, 'inbox')}
                  >
                    <Inbox size={11} />
                    <span>Hộp thư đến</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.tagPill} ${rec.category === 'priority' ? styles.tagPillActive : ''}`}
                    onClick={() => void handleChangeCategory(rec.id, 'priority')}
                  >
                    <Star size={11} />
                    <span>Ưu tiên</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.tagPill} ${rec.category === 'archive' ? styles.tagPillActive : ''}`}
                    onClick={() => void handleChangeCategory(rec.id, 'archive')}
                  >
                    <Archive size={11} />
                    <span>Lưu trữ</span>
                  </button>
                </div>
              </div>

              {/* 3 dots action menu button */}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={styles.actionMenuBtn}
                  onClick={() => setActiveMenuId(isMenuOpen ? null : rec.id)}
                  title="Tùy chọn"
                >
                  <MoreVertical size={18} />
                </button>

                {isMenuOpen && (
                  <div className={styles.dropdownMenu} ref={menuRef}>
                    <button
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setEditingId(rec.id);
                        setEditTitle(rec.title);
                        setActiveMenuId(null);
                      }}
                    >
                      <Pencil size={14} />
                      <span>Sửa tên</span>
                    </button>

                    <button
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMovingFolderIds([rec.id]);
                        setActiveMenuId(null);
                      }}
                    >
                      <FolderInput size={14} />
                      <span>Di chuyển bộ sưu tập</span>
                    </button>

                    <button
                      type="button"
                      className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                      onClick={() => void handleDeleteItem(rec)}
                    >
                      <Trash2 size={14} />
                      <span>Xóa</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Không có bản ghi nào trong mục này.
          </div>
        )}
      </div>
    </div>
  );
}
