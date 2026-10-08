'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Calendar } from 'lucide-react';
import { getRecording, getCaptions, getSummary } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import { InlineAudioPlayer } from '@/features/recording/inline-audio-player';
import { MobileRecordingDetail } from '@/features/recording/mobile-recording-detail';
import { fetchTranslationUsage } from '@/lib/api-client';
import { formatTokens, formatUsd, formatSaigonDate } from '@/features/usage/usage-format';
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
        const usageSummary = await fetchTranslationUsage({
          from: fromStr,
          to: toStr,
          recordingId: id,
        });
        if (!active || abortController.signal.aborted) return;
        if (usageSummary.totals.requests > 0) {
          const totalTokens =
            usageSummary.totals.inputTokens +
            usageSummary.totals.outputTokens +
            usageSummary.totals.thinkingTokens;
          const usdStr = usageSummary.totals.estimatedUsd != null ? `~${formatUsd(usageSummary.totals.estimatedUsd)}` : 'Chưa rõ';
          setCostText(`Chi phí dịch buổi này: ${usageSummary.totals.requests} request · ${formatTokens(totalTokens)} token · ${usdStr}`);
        } else {
          setCostText(null);
        }
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Session Title Header with LilysAI Player */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link
            href="/library"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
            }}
            title="Quay lại Thư viện"
          >
            <ArrowLeft size={16} />
          </Link>

          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {recording.title}
            </h2>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                marginTop: 2,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Calendar size={11} />
                {formatDate(recording.createdAt)}
              </span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={11} />
                {formatDuration(recording.durationMs)}
              </span>
              {costText && (
                <>
                  <span>•</span>
                  <span>{costText}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* LilysAI Integrated Audio Player in Header */}
        <InlineAudioPlayer recordingId={recording.id} durationMs={recording.durationMs} />
      </div>

      {/* Main Workspace Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
