'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Settings,
  Folder,
  FolderOpen,
  FolderPlus,
  Check,
  X,
  PanelLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Radio,
  Mic,
  FileAudio,
  Youtube,
  FileText,
  Globe,
  BarChart3,
  BookOpen,
} from 'lucide-react';
import {
  listRecordings,
  getCustomFolders,
  saveCustomFolders,
  deleteCustomFolder,
  renameCustomFolder,
} from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingRowItem } from './recording-list';
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
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderTitle, setEditFolderTitle] = useState('');
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
      setOpenFolders((prev) => ({ ...prev, [trimmed]: true }));
    }
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  const handleStartRenameFolder = (folder: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingFolder(folder);
    setEditFolderTitle(folder);
  };

  const handleSaveRenameFolder = async (folder: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const clean = editFolderTitle.trim();
    if (clean && clean !== folder) {
      await renameCustomFolder(folder, clean);
      await loadList();
    }
    setEditingFolder(null);
  };

  const handleDeleteFolder = async (folder: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (window.confirm(`Xóa thư mục "${folder}"? Các file ghi âm bên trong sẽ chuyển về Chưa phân loại, không bị xóa.`)) {
      await deleteCustomFolder(folder);
      await loadList();
    }
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
    return r.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const selectedId = pathname.startsWith('/recordings/') ? pathname.replace('/recordings/', '') : null;

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
          <span style={{ letterSpacing: '-0.02em' }}>Máy Dịch</span>
        </Link>

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Thu gọn thanh bên"
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

      {/* Action Row: Thêm mới & Search */}
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
            <span>Thêm mới</span>
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
                router.push('/app?action=new');
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
              <Mic size={15} color="var(--accent)" />
              <span>Ghi âm trực tiếp</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                router.push('/app?action=upload');
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
              <FileAudio size={15} color="#10b981" />
              <span>Tệp âm thanh / video</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng nhập từ YouTube đang được phát triển.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Youtube size={15} color="#ef4444" />
              <span>YouTube</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng nhập tài liệu PDF đang được phát triển.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <FileText size={15} color="#f59e0b" />
              <span>PDF</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                alert('Tính năng nhập trang web đang được phát triển.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Globe size={15} color="#8b5cf6" />
              <span>Trang web</span>
            </button>
          </div>
        )}
      </div>

      {/* Expandable Search Input */}
      {searchExpanded && (
        <div style={{ padding: '0 14px 8px 14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              padding: '4px 8px',
              gap: 6,
            }}
          >
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Tìm kiếm buổi học..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
              }}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Navigation & IDE Tree View */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 8px' }}>
        {/* Navigation Link: Trang chủ */}
        <Link
          href="/app"
          onClick={onCloseMobile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 10px',
            borderRadius: 'var(--radius-sm)',
            color: pathname === '/app' ? 'var(--accent)' : 'var(--text-primary)',
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

        {/* Tree Header: Thư viện & Nút + Thư mục */}
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {/* Click to expand/collapse Library tree */}
            <div
              onClick={() => setIsLibraryOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
                fontWeight: 600,
                userSelect: 'none',
              }}
            >
              {isLibraryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Thư viện</span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                ({recordings.length})
              </span>
            </div>

            {/* + Thư mục button (chỉ thêm thư mục 1 cấp ngoài) */}
            <button
              type="button"
              onClick={() => setShowNewFolderInput((v) => !v)}
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
                padding: '2px 4px',
                borderRadius: 3,
              }}
              title="Thêm thư mục mới"
            >
              <FolderPlus size={13} />
              <span>+ Thư mục</span>
            </button>
          </div>

          {/* New Folder Inline Form */}
          {showNewFolderInput && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                backgroundColor: 'var(--bg-primary)',
                padding: '4px 6px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--accent)',
                margin: '2px 4px 6px 4px',
              }}
            >
              <Folder size={13} color="#f59e0b" />
              <input
                type="text"
                placeholder="Tên thư mục mới..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFolder();
                  else if (e.key === 'Escape') setShowNewFolderInput(false);
                }}
                autoFocus
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.78rem',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                title="Lưu"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}
              >
                <Check size={13} color="var(--success)" />
              </button>
              <button
                type="button"
                onClick={() => setShowNewFolderInput(false)}
                title="Hủy"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}
              >
                <X size={13} color="var(--danger)" />
              </button>
            </div>
          )}

          {/* Scrollable IDE Tree Area */}
          {isLibraryOpen && (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: 2,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* 1. Custom Folders (IDE Explorer Style) */}
              {customFolders.map((folder) => {
                const folderRecordings = filtered.filter((r) => r.folder === folder);
                const isOpen = openFolders[folder] !== false; // default open
                const isRenaming = editingFolder === folder;

                return (
                  <div key={folder} style={{ marginBottom: 2 }}>
                    {/* Folder Header Row */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        height: 28,
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        backgroundColor: 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      className="recording-row-item"
                      onClick={() => setOpenFolders((prev) => ({ ...prev, [folder]: !isOpen }))}
                    >
                      {isRenaming ? (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editFolderTitle}
                            onChange={(e) => setEditFolderTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveRenameFolder(folder, e as unknown as React.MouseEvent);
                              if (e.key === 'Escape') setEditingFolder(null);
                            }}
                            style={{
                              flex: 1,
                              height: 20,
                              backgroundColor: 'var(--bg-primary)',
                              border: '1px solid var(--accent)',
                              borderRadius: 3,
                              fontSize: '0.78rem',
                              color: 'var(--text-primary)',
                              padding: '1px 4px',
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={(e) => handleSaveRenameFolder(folder, e)}
                            title="Lưu"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}
                          >
                            <Check size={12} color="var(--success)" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingFolder(null); }}
                            title="Hủy"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}
                          >
                            <X size={12} color="var(--danger)" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
                            {isOpen ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                            {isOpen ? <FolderOpen size={14} color="#f59e0b" /> : <Folder size={14} color="#f59e0b" />}
                            <span
                              style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: 'var(--text-primary)',
                              }}
                            >
                              {folder}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              ({folderRecordings.length})
                            </span>
                          </div>

                          {/* Quick action buttons for Folder */}
                          <div
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(e) => handleStartRenameFolder(folder, e)}
                              title="Đổi tên thư mục"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 2px' }}
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteFolder(folder, e)}
                              title="Xóa thư mục"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 2px' }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Folder Children (Indented like IDE tree) */}
                    {isOpen && (
                      <div style={{ paddingLeft: 12, marginTop: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {folderRecordings.length === 0 ? (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', padding: '3px 8px', fontStyle: 'italic' }}>
                            (Thư mục trống)
                          </div>
                        ) : (
                          folderRecordings.map((rec) => (
                            <RecordingRowItem
                              key={rec.id}
                              recording={rec}
                              customFolders={customFolders}
                              isSelected={selectedId === rec.id}
                              isActive={recordingState.recordingId === rec.id}
                              onRefresh={loadList}
                              onSelect={onCloseMobile}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 2. Uncategorized / Root Recordings */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: customFolders.length > 0 ? 3 : 0 }}>
                {customFolders.length > 0 && filtered.some((r) => !r.folder) && (
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px 2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Chưa phân loại
                  </div>
                )}
                {filtered
                  .filter((r) => !r.folder)
                  .map((rec) => (
                    <RecordingRowItem
                      key={rec.id}
                      recording={rec}
                      customFolders={customFolders}
                      isSelected={selectedId === rec.id}
                      isActive={recordingState.recordingId === rec.id}
                      onRefresh={loadList}
                      onSelect={onCloseMobile}
                    />
                  ))}
              </div>

              {/* 3. Thùng rác - Nằm ở cuối cùng của danh sách Thư viện khi lướt xuống */}
              <div style={{ marginTop: 'auto', paddingTop: 10, paddingBottom: 6 }}>
                <Link
                  href="/trash"
                  onClick={onCloseMobile}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 28,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    color: pathname === '/trash' ? 'var(--danger)' : 'var(--text-muted)',
                    backgroundColor: pathname === '/trash' ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                    fontSize: '0.8rem',
                    fontWeight: pathname === '/trash' ? 600 : 500,
                    textDecoration: 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                  <span>Thùng rác</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Dock: Cấu hình AI & Chi phí (Vị trí góc trái dưới) */}
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
