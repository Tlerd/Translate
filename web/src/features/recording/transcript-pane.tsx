'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CaptionItem } from '@/shared/recording';

interface TranscriptPaneProps {
  captions: CaptionItem[];
  highlightCaptionId?: number | null;
}

export function TranscriptPane({ captions, highlightCaptionId }: TranscriptPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          padding: 32,
          textAlign: 'center',
          gap: 12,
        }}
      >
        <p style={{ fontSize: '1rem' }}>Chưa có nội dung nói.</p>
        <p style={{ fontSize: '0.85rem' }}>
          Bấm <strong>Bắt đầu thu</strong> và nói vào micro (tiếng Nhật, tiếng Việt hoặc tiếng Anh).
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        padding: '16px 20px',
        gap: 16,
      }}
      onWheel={() => setAutoScroll(false)}
    >
      {captions.map((cap) => {
        const isHighlighted = highlightCaptionId === cap.id;
        const isStreaming = cap.state === 'streaming';

        return (
          <div
            key={cap.id}
            id={`caption-${cap.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: isHighlighted ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-secondary)',
              border: isHighlighted
                ? '1px solid var(--accent)'
                : '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              gap: 8,
              transition: 'background-color 0.3s, border-color 0.3s',
            }}
          >
            {/* Header: Timestamp and ID */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ fontWeight: 600 }}>#{cap.id} • {formatTimestamp(cap.startMs)}</span>
              {isStreaming && (
                <span
                  style={{
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent)',
                    }}
                  />
                  Đang dịch...
                </span>
              )}
            </div>

            {/* Original source */}
            <div style={{ fontSize: '0.98rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {cap.source}
            </div>

            {/* Translation */}
            <div
              style={{
                fontSize: '0.95rem',
                color: isStreaming ? 'var(--accent)' : 'var(--text-secondary)',
                lineHeight: 1.5,
                borderTop: '1px dashed var(--border-color)',
                paddingTop: 8,
              }}
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
