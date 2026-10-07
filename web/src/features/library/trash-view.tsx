'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, RotateCcw, AudioLines } from 'lucide-react';
import { listTrashRecordings, restoreRecording, deleteRecording, emptyTrash } from '@/storage/recordings';
import type { RecordingItem } from '@/shared/recording';

export function TrashView() {
  const [trashItems, setTrashItems] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrash = useCallback(async () => {
    try {
      const items = await listTrashRecordings(100);
      setTrashItems(items);
    } catch (err) {
      console.error('Lỗi tải thùng rác:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: string) => {
    try {
      await restoreRecording(id);
      await loadTrash();
    } catch (err) {
      alert(`Không thể khôi phục: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeletePermanent = async (id: string) => {
    if (window.confirm('Bạn có chắc muốn xóa vĩnh viễn bản ghi này? Hành động này không thể hoàn tác.')) {
      try {
        await deleteRecording(id);
        await loadTrash();
      } catch (err) {
        alert(`Không thể xóa: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleEmptyAll = async () => {
    if (window.confirm('Bạn có chắc muốn xóa vĩnh viễn TẤT CẢ các bản ghi trong thùng rác?')) {
      try {
        await emptyTrash();
        await loadTrash();
      } catch (err) {
        alert(`Lỗi khi dọn thùng rác: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Thùng rác
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Tự động xóa sau 30 ngày
          </p>
        </div>

        {trashItems.length > 0 && (
          <button
            type="button"
            onClick={handleEmptyAll}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              backgroundColor: 'transparent',
              color: 'var(--danger)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Trash2 size={15} />
            <span>Xóa vĩnh viễn tất cả</span>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '32px 0' }}>Đang tải thùng rác...</div>
      ) : trashItems.length === 0 ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Trash2 size={36} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: '1rem', fontWeight: 500 }}>Thùng rác trống</p>
          <p style={{ fontSize: '0.84rem', marginTop: 4 }}>Không có bản ghi nào bị xóa tạm thời.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {trashItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-sm)',
                gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <AudioLines size={14} color="var(--accent)" />
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    Ghi âm
                  </span>
                </div>
                <div style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {item.deletedAt ? `Đã xóa lúc ${formatDate(item.deletedAt)}` : `Tạo lúc ${formatDate(item.createdAt)}`}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => handleRestore(item.id)}
                  title="Khôi phục về thư viện"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={14} />
                  <span>Khôi phục</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeletePermanent(item.id)}
                  title="Xóa vĩnh viễn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--danger)',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={14} />
                  <span>Xóa vĩnh viễn</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
