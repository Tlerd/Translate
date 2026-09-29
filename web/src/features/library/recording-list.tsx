'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Volume2,
  VolumeX,
  Trash2,
  Download,
  Edit2,
  MoreVertical,
  Check,
  X,
} from 'lucide-react';
import type { RecordingItem } from '@/shared/recording';
import {
  renameRecording,
  deleteRecording,
  deleteAudioOnly,
} from '@/storage/recordings';
import { exportRecordingData } from '@/storage/export-import';

interface RecordingListProps {
  recordings: RecordingItem[];
  selectedId: string | null;
  activeRecordingId: string | null;
  onRefresh: () => void;
  onSelect?: () => void;
}

export function RecordingList({
  recordings,
  selectedId,
  activeRecordingId,
  onRefresh,
  onSelect,
}: RecordingListProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const handleStartRename = (rec: RecordingItem, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(rec.id);
    setEditTitle(rec.title);
    setOpenMenuId(null);
  };

  const handleSaveRename = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (editTitle.trim()) {
      await renameRecording(id, editTitle.trim());
      onRefresh();
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(null);
  };

  const handleExport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    try {
      const exportData = await exportRecordingData(id);
      // Download JSON bundle
      const blob = new Blob([exportData.jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `buoi_hoc_${id}.json`;
      a.click();
      URL.revokeObjectURL(url);

      // Download audio if present
      if (exportData.audioBlob && exportData.audioFileName) {
        const audioUrl = URL.createObjectURL(exportData.audioBlob);
        const aAudio = document.createElement('a');
        aAudio.href = audioUrl;
        aAudio.download = exportData.audioFileName;
        aAudio.click();
        URL.revokeObjectURL(audioUrl);
      }
    } catch (err) {
      alert(`Lỗi xuất bản ghi: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteAudio = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    if (window.confirm('Bạn có chắc muốn xóa file âm thanh của buổi này? (Chữ gốc, bản dịch và tóm tắt vẫn được giữ lại)')) {
      try {
        await deleteAudioOnly(id);
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpenMenuId(null);
    if (window.confirm('Bạn có chắc muốn xóa toàn bộ buổi này và các dữ liệu liên quan?')) {
      try {
        await deleteRecording(id);
        onRefresh();
        if (selectedId === id) {
          router.push('/');
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}p ${s.toString().padStart(2, '0')}s`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return iso;
    }
  };

  if (recordings.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        Chưa có bản ghi nào. Bấm &ldquo;+ Buổi mới&rdquo; để bắt đầu.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px' }}>
      {recordings.map((rec) => {
        const isSelected = selectedId === rec.id;
        const isActiveRecording = activeRecordingId === rec.id;
        const isEditing = editingId === rec.id;
        const isMenuOpen = openMenuId === rec.id;

        return (
          <div
            key={rec.id}
            style={{
              position: 'relative',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            <Link
              href={`/recordings/${rec.id}`}
              onClick={onSelect}
              style={{
                display: 'block',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                color: isSelected ? '#fff' : 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                {isEditing ? (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      style={{
                        flex: 1,
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: '0.85rem',
                      }}
                      autoFocus
                    />
                    <button onClick={(e) => handleSaveRename(rec.id, e)} title="Lưu">
                      <Check size={16} color="var(--success)" />
                    </button>
                    <button onClick={handleCancelRename} title="Hủy">
                      <X size={16} color="var(--danger)" />
                    </button>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: isSelected ? 600 : 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                    }}
                  >
                    {rec.title}
                  </span>
                )}

                {/* Status Dot */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isActiveRecording ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: 'var(--danger)',
                      }}
                      title="Đang thu"
                    />
                  ) : rec.state === 'stopped' ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: 'var(--success)',
                      }}
                      title="Đã dừng"
                    />
                  ) : (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: 'var(--warning)',
                      }}
                      title="Gián đoạn"
                    />
                  )}

                  {/* Menu Button */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : rec.id);
                    }}
                    style={{
                      padding: 4,
                      color: isSelected ? '#fff' : 'var(--text-muted)',
                      opacity: 0.8,
                    }}
                    title="Tùy chọn"
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>

              {/* Meta row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.75rem',
                  color: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
                  marginTop: 4,
                }}
              >
                <span>{formatDate(rec.createdAt)}</span>
                <span>•</span>
                <span>{formatDuration(rec.durationMs)}</span>
                <span>•</span>
                {rec.audioState === 'present' ? (
                  <span title="Có âm thanh"><Volume2 size={13} /></span>
                ) : (
                  <span title="Âm thanh đã xóa hoặc thiếu"><VolumeX size={13} /></span>
                )}
              </div>
            </Link>

            {/* Context Action Menu Dropdown */}
            {isMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 8,
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 100,
                  minWidth: 160,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => handleStartRename(rec, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    textAlign: 'left',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                  }}
                >
                  <Edit2 size={14} />
                  <span>Đổi tên</span>
                </button>

                <button
                  onClick={(e) => handleExport(rec.id, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    textAlign: 'left',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                  }}
                >
                  <Download size={14} />
                  <span>Xuất bản ghi</span>
                </button>

                {rec.audioState === 'present' && !isActiveRecording && (
                  <button
                    onClick={(e) => handleDeleteAudio(rec.id, e)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: '0.82rem',
                      textAlign: 'left',
                      borderRadius: 4,
                      color: 'var(--warning)',
                    }}
                  >
                    <VolumeX size={14} />
                    <span>Xóa audio</span>
                  </button>
                )}

                {!isActiveRecording && (
                  <button
                    onClick={(e) => handleDeleteSession(rec.id, e)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: '0.82rem',
                      textAlign: 'left',
                      borderRadius: 4,
                      color: 'var(--danger)',
                    }}
                  >
                    <Trash2 size={14} />
                    <span>Xóa cả buổi</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
