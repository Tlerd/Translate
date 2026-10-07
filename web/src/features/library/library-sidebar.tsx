'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Settings,
  Folder,
  FolderPlus,
  Check,
  X,
  PanelLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  Radio,
  Mic,
  FileAudio,
  Youtube,
  FileText,
  Globe,
  BarChart3,
  BookOpen,
} from 'lucide-react';
import { listRecordings, getCustomFolders, saveCustomFolders } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingList } from './recording-list';
import { useRecording } from '@/features/recording/recording-context';
import type { RecordingItem } from '@/shared/recording';

interface LibrarySidebarProps {
  onCloseMobile?: () => void;
  onToggleSidebar?: () => void;
}

export function LibrarySidebar({ onCloseMobile, onToggleSidebar }: LibrarySidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { state: recordingState } = useRecording();

  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(false);

  const addMenuRef = useRef<HTMLDivElement>(null);

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
    void loadList();
    const interval = setInterval(loadList, 3000);
    const reload = () => { void loadList(); };
    window.addEventListener(dataEvent, reload);
    return () => { clearInterval(interval); window.removeEventListener(dataEvent, reload); };
  }, [loadList]);

  // Close add popover on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    if (isAddMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAddMenuOpen]);

  const filtered = recordings.filter((r) => {
    const matchesQuery = r.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (selectedFolder === 'all') return true;
    if (selectedFolder === '__none__') return !r.folder;
    return r.folder === selectedFolder;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Header Row with Logo and Toggle Button */}
      <div
        style={{
          padding: '14px 14px 10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <Link
          href="/app"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-primary)',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={19} color="var(--accent)" />
          </span>
          <span>Máy Dịch</span>
        </Link>

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Thu gọn thanh bên"
            aria-label="Thu gọn thanh bên"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <PanelLeft size={16} />
          </button>
        )}
      </div>

      {/* Action Row: + Thêm mới & Search */}
      <div style={{ padding: '12px 14px 8px 14px', position: 'relative' }} ref={addMenuRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setIsAddMenuOpen((v) => !v)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 14px',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontWeight: 600,
              fontSize: '0.84rem',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-sm)',
              transition: 'all 0.15s ease',
            }}
          >
            <Plus size={15} color="var(--accent)" />
            <span>+ Thêm mới</span>
          </button>

          <button
            type="button"
            onClick={() => setSearchExpanded((v) => !v)}
            title="Tìm kiếm"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-card)',
              color: searchExpanded ? 'var(--accent)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Search size={14} />
          </button>
        </div>

        {/* LilysAI style Popover Dropdown for + Thêm mới */}
        {isAddMenuOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 14,
              right: 14,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
              zIndex: 120,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                router.push('/app');
                onCloseMobile?.();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Mic size={16} color="var(--accent)" />
              <span>Ghi âm trực tiếp</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng tải lên tệp âm thanh / video sẵn sàng trong phiên bản tiếp theo.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <FileAudio size={16} color="var(--text-muted)" />
              <span>Tệp video / âm thanh</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng YouTube URL sẵn sàng trong phiên bản tiếp theo.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Youtube size={16} color="var(--danger)" />
              <span>YouTube</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng tải tài liệu PDF sẵn sàng trong phiên bản tiếp theo.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <FileText size={16} color="var(--text-muted)" />
              <span>PDF / Tài liệu</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng Trang web sẵn sàng trong phiên bản tiếp theo.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Globe size={16} color="var(--text-muted)" />
              <span>Trang web</span>
            </button>
          </div>
        )}

        {/* Search input when toggled or active */}
        {searchExpanded && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              padding: '5px 10px',
              marginTop: 8,
            }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Tìm kiếm..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                fontSize: '0.82rem',
                width: '100%',
                color: 'var(--text-primary)',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Nav Tree: Trang chủ & Thư viện */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px 10px' }}>
        {/* Trang chủ link */}
        <Link
          href="/app"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            color: pathname === '/app' ? 'var(--accent)' : 'var(--text-secondary)',
            backgroundColor: pathname === '/app' ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
            fontSize: '0.86rem',
            fontWeight: pathname === '/app' ? 600 : 500,
            textDecoration: 'none',
            marginBottom: 2,
          }}
        >
          <BookOpen size={16} />
          <span>Trang chủ</span>
        </Link>

        {/* Tree Item: Thư viện (Collapsible) */}
        <div style={{ marginTop: 2 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
            onClick={() => setIsLibraryOpen((v) => !v)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              <Folder size={16} color="var(--accent)" />
              <span>Thư viện</span>
              {isLibraryOpen ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowNewFolderInput((v) => !v);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontWeight: 600,
              }}
              title="Tạo thư mục mới"
            >
              <FolderPlus size={14} />
              <span>+ Thư mục</span>
            </button>
          </div>

          {/* New Folder Inline Form */}
          {showNewFolderInput && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--bg-primary)', padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', margin: '4px 6px' }}>
              <input
                type="text"
                placeholder="Tên thư mục..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); else if (e.key === 'Escape') setShowNewFolderInput(false); }}
                autoFocus
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.8rem', color: 'var(--text-primary)' }}
              />
              <button type="button" onClick={handleCreateFolder} title="Lưu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <Check size={14} color="var(--success)" />
              </button>
              <button type="button" onClick={() => setShowNewFolderInput(false)} title="Hủy" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={14} color="var(--danger)" />
              </button>
            </div>
          )}

          {/* Tree-view children: Folder chips & Sub-list of recordings */}
          {isLibraryOpen && (
            <div style={{ paddingLeft: 6, marginTop: 4 }}>
              {/* Folder filter chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', paddingBottom: 6, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => setSelectedFolder('all')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    borderRadius: 'var(--radius-full)',
                    border: selectedFolder === 'all' ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                    background: selectedFolder === 'all' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
                    color: selectedFolder === 'all' ? 'var(--accent)' : 'var(--text-secondary)',
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
                        fontSize: '0.72rem',
                        borderRadius: 'var(--radius-full)',
                        border: isSel ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                        background: isSel ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
                        color: isSel ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontWeight: isSel ? 600 : 400,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <Folder size={10} />
                      <span>{folder} ({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Sub-list of recordings with max-height and clean scroll */}
              <div style={{ maxHeight: 250, overflowY: 'auto', paddingRight: 2 }}>
                <RecordingList
                  recordings={filtered}
                  customFolders={customFolders}
                  selectedId={pathname.startsWith('/recordings/') ? pathname.replace('/recordings/', '') : null}
                  activeRecordingId={recordingState.recordingId}
                  onRefresh={loadList}
                  onSelect={onCloseMobile}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tree Item: Thùng rác */}
        <div style={{ marginTop: 6 }}>
          <Link
            href="/trash"
            onClick={onCloseMobile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              color: pathname === '/trash' ? 'var(--danger)' : 'var(--text-secondary)',
              backgroundColor: pathname === '/trash' ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
              fontSize: '0.86rem',
              fontWeight: pathname === '/trash' ? 600 : 500,
              textDecoration: 'none',
            }}
          >
            <Trash2 size={16} />
            <span>Thùng rác</span>
          </Link>
        </div>
      </div>

      {/* Bottom Dock: Cấu hình AI & Chi phí */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Link
          href="/settings"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          <Settings size={15} />
          <span>Cấu hình AI</span>
        </Link>

        <Link
          href="/usage"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          <BarChart3 size={15} />
          <span>Chi phí</span>
        </Link>
      </div>
    </div>
  );
}
