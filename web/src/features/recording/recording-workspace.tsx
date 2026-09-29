'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Sparkles, Volume2 } from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { SummaryPanel } from '@/features/summary/summary-panel';
import { ImagePanel } from '@/features/images/image-panel';
import { getAudioBlob } from '@/storage/recordings';
import type { CaptionItem, SummaryItem, RecordingItem } from '@/shared/recording';

interface RecordingWorkspaceProps {
  recording: RecordingItem;
  captions: CaptionItem[];
  summary?: SummaryItem;
  onSummaryUpdated?: (summary: SummaryItem) => void;
}

export function RecordingWorkspace({
  recording,
  captions,
  summary: initialSummary,
  onSummaryUpdated,
}: RecordingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [summary, setSummary] = useState<SummaryItem | undefined>(initialSummary);
  const [highlightCaptionId, setHighlightCaptionId] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  // Load audio if present
  useEffect(() => {
    let currentUrl: string | null = null;
    if (recording.audioState === 'present') {
      getAudioBlob(recording.id).then((res) => {
        if (res) {
          const url = URL.createObjectURL(res.blob);
          currentUrl = url;
          setAudioUrl(url);
        }
      });
    }
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [recording.id, recording.audioState]);

  const handleSelectCaption = (captionId: number) => {
    setActiveTab('transcript');
    setHighlightCaptionId(captionId);

    // Scroll to the element
    setTimeout(() => {
      const el = document.getElementById(`caption-${captionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleSummaryGenerated = (newSummary: SummaryItem) => {
    setSummary(newSummary);
    if (onSummaryUpdated) onSummaryUpdated(newSummary);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-secondary)',
          height: 48,
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setActiveTab('transcript')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              fontSize: '0.88rem',
              fontWeight: activeTab === 'transcript' ? 600 : 400,
              color: activeTab === 'transcript' ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'transcript' ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <FileText size={16} />
            <span>Bản dịch ({captions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              fontSize: '0.88rem',
              fontWeight: activeTab === 'summary' ? 600 : 400,
              color: activeTab === 'summary' ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'summary' ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <Sparkles size={16} />
            <span>Tóm tắt {summary ? '✓' : ''}</span>
          </button>
        </div>

        {/* Audio playback player */}
        {audioUrl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Volume2 size={16} color="var(--accent)" />
            <audio
              src={audioUrl}
              controls
              style={{
                height: 32,
                outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Main View Area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'transcript' ? (
          <TranscriptPane
            captions={captions}
            highlightCaptionId={highlightCaptionId}
          />
        ) : (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <SummaryPanel
              recordingId={recording.id}
              captions={captions}
              summary={summary}
              targetLanguage={recording.targetLanguage}
              onSummaryGenerated={handleSummaryGenerated}
              onSelectCaption={handleSelectCaption}
            />
            {summary && <ImagePanel recordingId={recording.id} summary={summary} />}
          </div>
        )}
      </div>
    </div>
  );
}
