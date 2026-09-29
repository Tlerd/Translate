'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Calendar, BookOpen, Layers } from 'lucide-react';
import { getRecording, getCaptions, getSummary } from '@/storage/recordings';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import type { RecordingItem, CaptionItem, SummaryItem } from '@/shared/recording';

export default function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [recording, setRecording] = useState<RecordingItem | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [summary, setSummary] = useState<SummaryItem | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([getRecording(id), getCaptions(id), getSummary(id)])
      .then(([rec, caps, sum]) => {
        if (!isMounted) return;
        setRecording(rec || null);
        setCaptions(caps);
        setSummary(sum);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Lỗi tải bản ghi:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Đang tải bản ghi...
      </div>
    );
  }

  if (!recording) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        <p style={{ color: 'var(--text-muted)' }}>Không tìm thấy bản ghi #{id}.</p>
        <Link
          href="/"
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--bg-active)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
          }}
        >
          Quay về trang chủ
        </Link>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m} phút ${s} giây`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('vi-VN');
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Session Title Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
            }}
            title="Quay lại"
          >
            <ArrowLeft size={16} />
          </Link>

          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>{recording.title}</h2>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                marginTop: 2,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} />
                {formatDate(recording.createdAt)}
              </span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={12} />
                {formatDuration(recording.durationMs)}
              </span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {recording.mode === 'lecture' ? <BookOpen size={12} /> : <Layers size={12} />}
                {recording.mode === 'lecture' ? 'Giảng bài' : 'Luyện đọc'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RecordingWorkspace
          recording={recording}
          captions={captions}
          summary={summary}
          onSummaryUpdated={setSummary}
        />
      </div>
    </div>
  );
}
