'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus, Search, Settings, Folder, FolderPlus, Check, X } from 'lucide-react';
import { listRecordings, getCustomFolders, saveCustomFolders } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingList } from './recording-list';
import { useRecording } from '@/features/recording/recording-context';
import type { RecordingItem } from '@/shared/recording';

export function LibrarySidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const params = useParams();
  const currentId = typeof params?.id === 'string' ? params.id : null;

  const { state: recordingState } = useRecording();
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadList = useCallback(async () => {
    try {
      const [items, folders] = await Promise.all([
        listRecordings(100),
        getCustomFolders(),
      ]);
      setRecordings(items);
      setCustomFolders(folders);
    } catch (err) {
      console.error('Lỗi tải danh sách bản ghi:', err);
    }
  }, []);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setShowNewFolderInput(false);
      return;
    }
    if (!customFolders.includes(trimmed)) {
      const next = [...customFolders, trimmed];
      await saveCustomFolders(next);
      setCustomFolders(next);
      setSelectedFolder(trimmed);
    }
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  useEffect(() => {
    loadList();
    // Refresh periodically or on state change
    const interval = setInterval(loadList, 3000);
    const reload = () => { void loadList(); };
    window.addEventListener(dataEvent, reload);
    return () => { clearInterval(interval); window.removeEventListener(dataEvent, reload); };
  }, [loadList]);

  const filtered = recordings.filter((r) => {
    const matchesQuery = r.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (selectedFolder === 'all') return true;
    if (selectedFolder === '__none__') return !r.folder;
    return r.folder === selectedFolder;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header action */}
      <div style={{ padding: '14px 12px 8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Title and Add Folder */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Folder size={18} color="var(--accent)" />
            Thư viện
          </span>
          <button
            type="button"
            onClick={() => setShowNewFolderInput((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
            }}
            title="Tạo thư mục mới"
          >
            <FolderPlus size={15} />
            <span>+ Thư mục</span>
          </button>
        </div>

        {/* New Folder Inline Form */}
        {showNewFolderInput && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--bg-primary)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)' }}>
            <input
              type="text"
              placeholder="Tên thư mục mới..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); else if (e.key === 'Escape') setShowNewFolderInput(false); }}
              autoFocus
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.82rem', color: 'var(--text-primary)' }}
            />
            <button type="button" onClick={handleCreateFolder} title="Lưu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
              <Check size={16} color="var(--success)" />
            </button>
            <button type="button" onClick={() => setShowNewFolderInput(false)} title="Hủy" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
              <X size={16} color="var(--danger)" />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/app"
            onClick={onCloseMobile}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '9px 14px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: '0.88rem',
            }}
          >
            <Plus size={18} />
            <span>Buổi mới</span>
          </Link>
        </div>

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
          }}
        >
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Tìm bản ghi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: '0.85rem',
              width: '100%',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Folder filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
          <button
            type="button"
            onClick={() => setSelectedFolder('all')}
            style={{
              padding: '3px 8px',
              fontSize: '0.74rem',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-color)',
              background: selectedFolder === 'all' ? 'var(--bg-active)' : 'var(--bg-card)',
              color: selectedFolder === 'all' ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: selectedFolder === 'all' ? 600 : 400,
            }}
          >
            Tất cả ({recordings.length})
          </button>

          {customFolders.map((folder) => {
            const count = recordings.filter((r) => r.folder === folder).length;
            const isSel = selectedFolder === folder;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => setSelectedFolder(folder)}
                style={{
                  padding: '3px 8px',
                  fontSize: '0.74rem',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--border-color)',
                  background: isSel ? 'var(--bg-active)' : 'var(--bg-card)',
                  color: isSel ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontWeight: isSel ? 600 : 400,
                }}
              >
                {folder} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Recording list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <RecordingList
          recordings={filtered}
          customFolders={customFolders}
          selectedId={currentId}
          activeRecordingId={recordingState.recordingId}
          onRefresh={loadList}
          onSelect={onCloseMobile}
        />
      </div>

      {/* Bottom Link */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/settings"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
          }}
        >
          <Settings size={16} />
          <span>Cấu hình AI</span>
        </Link>
      </div>
    </div>
  );
}
