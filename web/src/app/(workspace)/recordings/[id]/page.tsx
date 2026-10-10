'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, PanelLeft } from 'lucide-react';
import { getRecording, getCaptions, getSummary } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import { InlineAudioPlayer } from '@/features/recording/inline-audio-player';
import { MobileRecordingDetail } from '@/features/recording/mobile-recording-detail';
import { useSidebarToggle } from '@/components/sidebar-context';
import { fetchSpeechUsage, fetchTranslationUsage } from '@/lib/api-client';
import { formatSaigonDate, recordingCostText } from '@/features/usage/usage-format';
import type { RecordingItem, CaptionItem, SummaryItem } from '@/shared/recording';
import styles from './detail-header.module.css';

export default function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const { sidebarOpen, toggleSidebar } = useSidebarToggle();

  const [recording, setRecording] = useState<RecordingItem | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [summary, setSummary] = useState<SummaryItem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [costText, setCostText] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();
    const fetchCost = async () => {
      try {
        const today = new Date();
        let fromDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        if (recording?.createdAt) {
          const recDate = new Date(recording.createdAt);
          if (!isNaN(recDate.getTime())) {
            const startFrom = new Date(recDate.getTime() - 24 * 60 * 60 * 1000);
            if (startFrom.getTime() > fromDate.getTime()) {
              fromDate = startFrom;
            }
          }
        }
        const fromStr = formatSaigonDate(fromDate);
        const toStr = formatSaigonDate(today);
        const query = { from: fromStr, to: toStr, recordingId: id };
        // Either source may be unavailable (store off, request failed); show whatever loaded.
        const [translation, speech] = await Promise.allSettled([fetchTranslationUsage(query), fetchSpeechUsage(query)]);
        if (!active || abortController.signal.aborted) return;
        setCostText(recordingCostText(
          translation.status === 'fulfilled' ? translation.value : null,
          speech.status === 'fulfilled' ? speech.value : null,
        ));
      } catch {
        if (active) setCostText(null);
      }
    };
    void fetchCost();
    return () => {
      active = false;
      abortController.abort();
    };
  }, [id, recording?.createdAt]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const reload = () => { void Promise.all([getRecording(id), getCaptions(id), getSummary(id)])
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
      }); };
    reload();
    window.addEventListener(dataEvent, reload);

    return () => {
      isMounted = false;
      window.removeEventListener(dataEvent, reload);
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
          href="/library"
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

  if (isMobile) {
    return (
      <MobileRecordingDetail
        recording={recording}
        captions={captions}
        summary={summary}
        onSummaryUpdated={setSummary}
        costText={costText}
      />
    );
  }

  // Left part of RecordingWorkspace's single top row: sidebar toggle, back, title, meta, audio player.
  const header = (
    <div className={styles.header}>
      <button
        type="button"
        onClick={toggleSidebar}
        className={styles.iconButton}
        title={sidebarOpen ? 'Đóng thanh bên' : 'Mở thanh bên'}
        aria-label={sidebarOpen ? 'Đóng thanh bên' : 'Mở thanh bên'}
        aria-expanded={sidebarOpen}
        aria-controls="recording-library"
      >
        <PanelLeft size={16} />
      </button>

      <Link
        href="/library"
        className={styles.iconButton}
        title="Quay lại Thư viện"
        aria-label="Quay lại Thư viện"
      >
        <ArrowLeft size={16} />
      </Link>

      <div className={styles.titleBlock}>
        <h2 className={styles.title}>{recording.title}</h2>
        <div className={styles.meta} title={costText ?? undefined}>
          {formatDate(recording.createdAt)} • {formatDuration(recording.durationMs)}
        </div>
      </div>

      <div className={styles.player}>
        <InlineAudioPlayer recordingId={recording.id} durationMs={recording.durationMs} />
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <RecordingWorkspace
        recording={recording}
        captions={captions}
        summary={summary}
        onSummaryUpdated={setSummary}
        header={header}
      />
    </div>
  );
}
