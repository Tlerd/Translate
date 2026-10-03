'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus, Search, Settings } from 'lucide-react';
import { listRecordings } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingList } from './recording-list';
import { useRecording } from '@/features/recording/recording-context';
import type { RecordingItem } from '@/shared/recording';

export function LibrarySidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const params = useParams();
  const currentId = typeof params?.id === 'string' ? params.id : null;

  const { state: recordingState } = useRecording();
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const loadList = useCallback(async () => {
    try {
      const items = await listRecordings(100);
      setRecordings(items);
    } catch (err) {
      console.error('Lỗi tải danh sách bản ghi:', err);
    }
  }, []);

  useEffect(() => {
    loadList();
    // Refresh periodically or on state change
    const interval = setInterval(loadList, 3000);
    const reload = () => { void loadList(); };
    window.addEventListener(dataEvent, reload);
    return () => { clearInterval(interval); window.removeEventListener(dataEvent, reload); };
  }, [loadList]);

  const filtered = recordings.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header action */}
      <div style={{ padding: '16px 12px 8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              padding: '10px 14px',
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
            }}
          />
        </div>
      </div>

      {/* Recording list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <RecordingList
          recordings={filtered}
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
