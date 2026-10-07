'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import type { CaptionItem } from '@/shared/recording';
import { displaySpeakerLabel, SPEAKER_COUNTS, type SpeakerCount } from '@/shared/transcription';
import styles from './recording-ui.module.css';

interface TranscriptPaneProps {
  captions: CaptionItem[];
  highlightCaptionId?: number | null;
  speakerCount?: SpeakerCount;
  targetLanguage?: string;
  onSpeakerChange?: (captionId: number, speakerLabel: string | undefined) => Promise<void>;
}

export function TranscriptPane({ captions, highlightCaptionId, speakerCount = 8, targetLanguage, onSpeakerChange }: TranscriptPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [pendingSpeakerId, setPendingSpeakerId] = useState<number | null>(null);
  const [speakerError, setSpeakerError] = useState<string | null>(null);

  const changeSpeaker = async (captionId: number, label: string) => {
    if (!onSpeakerChange || pendingSpeakerId !== null) return;
    setPendingSpeakerId(captionId);
    setSpeakerError(null);
    try { await onSpeakerChange(captionId, label || undefined); }
    catch (error) { setSpeakerError(error instanceof Error ? error.message : String(error)); }
    finally { setPendingSpeakerId(null); }
  };

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // User is considered at the bottom if within 48px
    const isNearBottom = distanceToBottom <= 48;
    setAutoScroll(isNearBottom);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    setAutoScroll(true);
    const el = containerRef.current;
    if (el) {
      if (smooth) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      const el = containerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [captions, autoScroll]);

  const getSpeakerColor = (label?: string) => {
    if (!label) return '#6366f1';
    const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'];
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash += label.charCodeAt(i);
    return colors[hash % colors.length];
  };

  const formatTimestamp = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (captions.length === 0) {
    return (
      <div data-testid="transcript-empty-state" className={styles.emptyTranscript} style={{ color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '1rem', fontWeight: 600 }}>Chưa có nội dung nói</p>
        <p style={{ fontSize: '0.85rem' }}>
          Bấm <strong>Bắt đầu thu</strong> và nói vào micro để nhận diện giọng nói và dịch thời gian thực.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="transcript-pane"
      className={styles.transcriptPane}
      onScroll={handleScroll}
      onTouchMove={handleScroll}
    >
      {speakerError && <div role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{speakerError}</div>}
      {captions.map((cap) => {
        const isHighlighted = highlightCaptionId === cap.id;
        const isStreaming = cap.state === 'streaming';
        const speakerNumber = cap.speakerLabel ? cap.speakerLabel.replace('spk_', '') : '1';

        return (
          <div
            key={cap.id}
            id={`caption-${cap.id}`}
            data-testid="caption-card"
            className={`${styles.captionCard} ${isHighlighted ? styles.captionCardHighlighted : ''}`}
            style={{ borderRadius: 12, padding: '12px 16px' }}
          >
            {/* Header: Speaker Avatar, Name, and Timestamp */}
            <div className={styles.captionHeader} style={{ marginBottom: 8 }}>
              <div className={styles.captionMeta} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundColor: getSpeakerColor(cap.speakerLabel),
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                  title={`Người nói ${speakerNumber}`}
                >
                  {speakerNumber}
                </div>

                {onSpeakerChange ? (
                  <select
                    aria-label={`Người nói cho câu ${cap.id}`}
                    className={styles.speakerSelect}
                    value={cap.speakerLabel ?? ''}
                    disabled={pendingSpeakerId !== null}
                    aria-busy={pendingSpeakerId === cap.id}
                    onChange={(event) => void changeSpeaker(cap.id, event.target.value)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <option value="">Speaker {speakerNumber}</option>
                    {cap.speakerLabel && !SPEAKER_COUNTS.slice(0, speakerCount).some(count => cap.speakerLabel === `spk_${count}`) && (
                      <option value={cap.speakerLabel} disabled>{displaySpeakerLabel(cap.speakerLabel)} (nhãn cũ)</option>
                    )}
                    {SPEAKER_COUNTS.slice(0, speakerCount).map(count => <option key={count} value={`spk_${count}`}>Speaker {count}</option>)}
                  </select>
                ) : (
                  <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    Speaker {speakerNumber}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {isStreaming && (
                  <span className={styles.streamingBadge}>
                    <span className={styles.streamingDot} />
                    {cap.isFinal && targetLanguage !== 'none' ? 'Đang dịch...' : 'Đang nghe...'}
                  </span>
                )}
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                  {formatTimestamp(cap.startMs)}
                </span>
              </div>
            </div>

            {/* Original source */}
            <div
              data-testid="caption-source"
              className={styles.captionText}
              style={{ fontWeight: 500, fontSize: '0.96rem', lineHeight: 1.5, color: 'var(--text-primary)' }}
            >
              {cap.source}
            </div>

            {cap.sourceHistory?.length ? (
              <details className={styles.sourceHistory} style={{ marginTop: 4 }}>
                <summary>Lời nhận dạng trước đó ({cap.sourceHistory.length})</summary>
                <ol>
                  {cap.sourceHistory.map((item) => (
                    <li key={`${item.revision}-${item.text}`}>
                      <span>{item.text}</span>
                      <span className={styles.historyRevision}>Bản {item.revision}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            {/* Translation */}
            {targetLanguage !== 'none' && (cap.translation || isStreaming) && (
              <div
                className={styles.captionTranslation}
                data-testid="caption-translation"
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  fontSize: '0.92rem',
                  lineHeight: 1.5,
                  color: 'var(--text-secondary)',
                  borderTop: 'none',
                }}
              >
                {cap.translation || (isStreaming ? '...' : '')}
                {cap.translation && cap.targetSourceRevision !== cap.revision && (
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--warning)', fontSize: '0.76rem' }}>
                    Bản dịch cũ — lời gốc đã được chỉnh sửa
                  </span>
                )}
              </div>
            )}

            {cap.error && (
              <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                Lỗi dịch: {cap.error}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
      {!autoScroll && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className={styles.scrollToBottomBtn}
          title="Cuộn xuống bản dịch mới nhất"
          aria-label="Cuộn xuống bản dịch mới nhất"
        >
          <ArrowDown size={14} />
          <span>Cuộn xuống cuối</span>
        </button>
      )}
    </div>
  );
}
