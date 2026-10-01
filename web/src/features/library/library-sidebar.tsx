'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { Plus, Search, Upload, Settings } from 'lucide-react';
import { listRecordings } from '@/storage/recordings';
import { importWebBundle, importApkExport } from '@/storage/export-import';
import { RecordingList } from './recording-list';
import { useRecording } from '@/features/recording/recording-context';
import type { RecordingItem, WebExportBundle, ApkExportJson } from '@/shared/recording';

export function LibrarySidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const router = useRouter();
  const params = useParams();
  const currentId = typeof params?.id === 'string' ? params.id : null;

  const { state: recordingState } = useRecording();
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    return () => clearInterval(interval);
  }, [loadList]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let jsonFile: File | null = null;
    let audioFile: File | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.endsWith('.json')) {
        jsonFile = file;
      } else if (file.name.endsWith('.wav') || file.name.endsWith('.webm') || file.name.endsWith('.mp4')) {
        audioFile = file;
      }
    }

    if (!jsonFile) {
      alert('Vui lòng chọn ít nhất một file JSON xuất bản ghi hoặc conversation.json từ APK.');
      return;
    }

    try {
      const text = await jsonFile.text();
      const parsed = JSON.parse(text);

      let imported: RecordingItem;
      if (parsed.schemaVersion === 1) {
        // Web export bundle
        imported = await importWebBundle(parsed as WebExportBundle, audioFile || undefined);
      } else if (parsed.session && Array.isArray(parsed.turns)) {
        // APK export
        imported = await importApkExport(parsed as ApkExportJson, audioFile || undefined);
      } else {
        throw new Error('File JSON không đúng định dạng xuất của Web hoặc APK.');
      }

      await loadList();
      router.push(`/recordings/${imported.id}`);
      if (onCloseMobile) onCloseMobile();
    } catch (err) {
      alert(`Lỗi nhập file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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

          <button
            onClick={handleImportClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 12px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
            }}
            title="Nhập bản ghi (JSON web hoặc APK conversation.json)"
          >
            <Upload size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.wav,.webm,.mp4"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
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
