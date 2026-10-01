'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CaptionItem } from '@/shared/recording';
import { displaySpeakerLabel, SPEAKER_COUNTS, type SpeakerCount } from '@/shared/transcription';
import styles from './recording-ui.module.css';

interface TranscriptPaneProps {
  captions: CaptionItem[];
  highlightCaptionId?: number | null;
  speakerCount?: SpeakerCount;
  onSpeakerChange?: (captionId: number, speakerLabel: string | undefined) => Promise<void>;
}

export function TranscriptPane({ captions, highlightCaptionId, speakerCount = 8, onSpeakerChange }: TranscriptPaneProps) {
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

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
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
        <p style={{ fontSize: '1rem' }}>Chưa có nội dung nói.</p>
        <p style={{ fontSize: '0.85rem' }}>
          Bấm <strong>Bắt đầu thu</strong> và nói vào micro (tiếng Nhật, tiếng Việt hoặc tiếng Anh).
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="transcript-pane"
      className={styles.transcriptPane}
      onWheel={() => setAutoScroll(false)}
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
                  Đang dịch...
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
            <div
              className={styles.captionTranslation}
              data-testid="caption-translation"
            >
              {cap.translation || (isStreaming ? '...' : '')}
              {!isStreaming && cap.translation && cap.targetSourceRevision !== cap.revision && (
                <span style={{ display: 'block', marginTop: 5, color: 'var(--warning)', fontSize: '0.78rem' }}>
                  Bản dịch cũ — lời gốc đã được chỉnh sửa
                </span>
              )}
            </div>

            {cap.error && (
              <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                Lỗi dịch: {cap.error}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
