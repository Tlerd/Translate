'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Trash2,
  Pencil,
  Check,
  X,
  FolderInput,
  AudioLines,
} from 'lucide-react';
import type { RecordingItem } from '@/shared/recording';
import {
  renameRecording,
  softDeleteRecording,
  updateRecordingFolder,
} from '@/storage/recordings';

export interface RecordingRowItemProps {
  recording: RecordingItem;
  customFolders: string[];
  isSelected: boolean;
  isActive: boolean;
  onRefresh: () => void;
  onSelect?: () => void;
}

export function RecordingRowItem({
  recording,
  customFolders,
  isSelected,
  isActive,
  onRefresh,
  onSelect,
}: RecordingRowItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(recording.title);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);

  const handleSaveRename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (editTitle.trim() && editTitle.trim() !== recording.title) {
      await renameRecording(recording.id, editTitle.trim());
      onRefresh();
    }
    setIsEditing(false);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsEditing(false);
    setEditTitle(recording.title);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (window.confirm(`Chuyển "${recording.title}" vào thùng rác?`)) {
      await softDeleteRecording(recording.id);
      onRefresh();
      if (isSelected) {
        router.push('/library');
      }
    }
  };

  const handleSelectFolder = async (folder: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await updateRecordingFolder(recording.id, folder);
    setIsFolderPickerOpen(false);
    onRefresh();
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 30,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
        color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
        transition: 'all 0.15s ease',
        cursor: 'pointer',
      }}
      className="recording-row-item"
    >
      {/* Inline Editing Mode */}
      {isEditing ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSaveRename(e as unknown as React.MouseEvent);
              if (e.key === 'Escape') handleCancelRename(e as unknown as React.MouseEvent);
            }}
            style={{
              flex: 1,
              height: 22,
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--accent)',
              borderRadius: 3,
              fontSize: '0.8rem',
              color: 'var(--text-primary)',
              padding: '1px 6px',
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={handleSaveRename}
            title="Lưu"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <Check size={13} color="var(--success)" />
          </button>
          <button
            type="button"
            onClick={handleCancelRename}
            title="Hủy"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <X size={13} color="var(--danger)" />
          </button>
        </div>
      ) : (
        <>
          {/* Main Clickable Link Area */}
          <Link
            href={`/recordings/${recording.id}`}
            onClick={onSelect}
            title={recording.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              flex: 1,
              minWidth: 0,
              textDecoration: 'none',
              color: 'inherit',
              overflow: 'hidden',
            }}
          >
            <AudioLines
              size={13}
              style={{
                flexShrink: 0,
                color: isActive ? 'var(--danger)' : isSelected ? 'var(--accent)' : 'var(--text-muted)',
              }}
            />
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: isSelected ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {recording.title}
            </span>
          </Link>

          {/* 3 Horizontal Quick Action Icons */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
              marginLeft: 6,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. 📁 Chuyển folder */}
            <button
              type="button"
              onClick={() => setIsFolderPickerOpen((v) => !v)}
              title="Chuyển vào thư mục"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 3px',
                color: isFolderPickerOpen ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 3,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              }}
            >
              <FolderInput size={12} />
            </button>

            {/* 2. ✏️ Đổi tên */}
            <button
              type="button"
              onClick={() => {
                setIsEditing(true);
                setEditTitle(recording.title);
              }}
              title="Đổi tên"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 3px',
                color: 'var(--text-muted)',
                borderRadius: 3,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              }}
            >
              <Pencil size={12} />
            </button>

            {/* 3. 🗑️ Xóa (chuyển thùng rác) */}
            <button
              type="button"
              onClick={handleDelete}
              title="Xóa vào thùng rác"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 3px',
                color: 'var(--text-muted)',
                borderRadius: 3,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Quick Folder Picker Dropdown */}
          {isFolderPickerOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 2px)',
                right: 4,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                zIndex: 120,
                minWidth: 160,
                display: 'flex',
                flexDirection: 'column',
                padding: '4px',
                gap: 2,
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  padding: '2px 6px',
                  borderBottom: '1px solid var(--border-subtle)',
                  marginBottom: 2,
                }}
              >
                Chuyển vào thư mục:
              </div>
              <button
                type="button"
                onClick={(e) => handleSelectFolder(null, e)}
                style={{
                  padding: '5px 8px',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  border: 'none',
                  borderRadius: 3,
                  background: !recording.folder ? 'var(--bg-hover)' : 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                (Không có thư mục)
              </button>
              {customFolders.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={(e) => handleSelectFolder(f, e)}
                  style={{
                    padding: '5px 8px',
                    textAlign: 'left',
                    fontSize: '0.78rem',
                    border: 'none',
                    borderRadius: 3,
                    background: recording.folder === f ? 'var(--bg-hover)' : 'transparent',
                    color: recording.folder === f ? 'var(--accent)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  📁 {f}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface RecordingListProps {
  recordings: RecordingItem[];
  customFolders?: string[];
  selectedId: string | null;
  activeRecordingId: string | null;
  onRefresh: () => void;
  onSelect?: () => void;
}

export function RecordingList({
  recordings,
  customFolders = [],
  selectedId,
  activeRecordingId,
  onRefresh,
  onSelect,
}: RecordingListProps) {
  if (recordings.length === 0) {
    return (
      <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        Chưa có bản ghi nào.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {recordings.map((rec) => (
        <RecordingRowItem
          key={rec.id}
          recording={rec}
          customFolders={customFolders}
          isSelected={selectedId === rec.id}
          isActive={activeRecordingId === rec.id}
          onRefresh={onRefresh}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
