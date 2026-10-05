'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Calendar, BookOpen, Layers } from 'lucide-react';
import { getRecording, getCaptions, getSummary } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
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
          href="/app"
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
            href="/app"
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
              {costText && (
                <>
                  <span>•</span>
                  <span>{costText}</span>
                </>
              )}
            </div>
          </div>
        </div>
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
