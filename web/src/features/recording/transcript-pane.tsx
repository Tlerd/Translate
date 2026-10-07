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

  const formatTimestamp = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

        return (
          <div
            key={cap.id}
            id={`caption-${cap.id}`}
            data-testid="caption-card"
            className={`${styles.captionCard} ${isHighlighted ? styles.captionCardHighlighted : ''}`}
          >
            {/* Header: Timestamp and ID */}
            <div className={styles.captionHeader}>
              <div className={styles.captionMeta}>
                <span style={{ fontWeight: 600 }}>#{cap.id} • {formatTimestamp(cap.startMs)}</span>
                {onSpeakerChange ? (
                  <select
                    aria-label={`Người nói cho câu ${cap.id}`}
                    className={styles.speakerSelect}
                    value={cap.speakerLabel ?? ''}
                    disabled={pendingSpeakerId !== null}
                    aria-busy={pendingSpeakerId === cap.id}
                    onChange={(event) => void changeSpeaker(cap.id, event.target.value)}
                  >
                    <option value="">Chưa gán người nói</option>
                    {cap.speakerLabel && !SPEAKER_COUNTS.slice(0, speakerCount).some(count => cap.speakerLabel === `spk_${count}`) && (
                      <option value={cap.speakerLabel} disabled>{displaySpeakerLabel(cap.speakerLabel)} (nhãn cũ)</option>
                    )}
                    {SPEAKER_COUNTS.slice(0, speakerCount).map(count => <option key={count} value={`spk_${count}`}>Speaker {count}</option>)}
                  </select>
                ) : cap.speakerLabel ? <span className={styles.speakerLabel}>{displaySpeakerLabel(cap.speakerLabel)}</span> : null}
              </div>
              {isStreaming && (
                <span className={styles.streamingBadge}>
                  <span className={styles.streamingDot} />
                  {cap.isFinal && targetLanguage !== 'none' ? 'Đang dịch...' : 'Đang nghe...'}
                </span>
              )}
            </div>

            {/* Original source */}
            <div data-testid="caption-source" className={styles.captionText}>
              {cap.source}
            </div>

            {cap.sourceHistory?.length ? (
              <details className={styles.sourceHistory}>
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
              >
                {cap.translation || (isStreaming ? '...' : '')}
                {cap.translation && cap.targetSourceRevision !== cap.revision && (
                  <span style={{ display: 'block', marginTop: 5, color: 'var(--warning)', fontSize: '0.78rem' }}>
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
