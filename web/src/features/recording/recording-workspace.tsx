'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Pencil, Sparkles, Volume2 } from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { TranscriptEditorDialog } from './transcript-editor-dialog';
import { SummaryPanel } from '@/features/summary/summary-panel';
import { ImagePanel } from '@/features/images/image-panel';
import { computeCaptionSourceHash, getAudioBlob, updateCaptionSources } from '@/storage/recordings';
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
  const [workspaceCaptions, setWorkspaceCaptions] = useState(captions);
  const [highlightCaptionId, setHighlightCaptionId] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [currentSourceHash, setCurrentSourceHash] = useState<string | null>(null);
  const recordingInProgress = recording.state === 'recording';
  const summaryIsStale = Boolean(summary && currentSourceHash && summary.sourceHash !== currentSourceHash);

  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  useEffect(() => {
    setWorkspaceCaptions(captions);
  }, [captions]);

  useEffect(() => {
    let active = true;
    computeCaptionSourceHash(workspaceCaptions).then((hash) => {
      if (active) setCurrentSourceHash(hash);
    });
    return () => { active = false; };
  }, [workspaceCaptions]);

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

  const handleSaveSources = async (sources: Array<{ id: number; source: string }>) => {
    const updated = await updateCaptionSources(recording.id, sources);
    const nextHash = await computeCaptionSourceHash(updated);
    setWorkspaceCaptions(updated);
    setCurrentSourceHash(nextHash);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-secondary)',
          minHeight: 48,
          gap: 8,
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
            <span>Bản dịch ({workspaceCaptions.length})</span>
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

        {activeTab === 'transcript' && workspaceCaptions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {recordingInProgress && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Kết thúc buổi thu để chỉnh sửa</span>}
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              disabled={recordingInProgress}
              title={recordingInProgress ? 'Không thể chỉnh sửa khi buổi thu đang chạy vì nội dung trực tiếp có thể ghi đè thay đổi.' : 'Chỉnh sửa kịch bản'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', color: recordingInProgress ? 'var(--text-muted)' : 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', opacity: recordingInProgress ? 0.55 : 1 }}
            >
              <Pencil size={14} /> Chỉnh sửa kịch bản
            </button>
          </div>
        )}

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
                maxWidth: 'min(42vw, 240px)',
              }}
            />
          </div>
        )}
      </div>

      {/* Main View Area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'transcript' ? (
          <TranscriptPane
            captions={workspaceCaptions}
            highlightCaptionId={highlightCaptionId}
          />
        ) : (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <SummaryPanel
              recordingId={recording.id}
              captions={workspaceCaptions}
              summary={summary}
              summaryIsStale={summaryIsStale}
              targetLanguage={recording.targetLanguage}
              translationModelKey={recording.config.translationModelKey}
              onSummaryGenerated={handleSummaryGenerated}
              onSelectCaption={handleSelectCaption}
            />
            {summary && currentSourceHash === summary.sourceHash && <ImagePanel recordingId={recording.id} summary={summary} />}
          </div>
        )}
      </div>
      {editorOpen && (
        <TranscriptEditorDialog
          captions={workspaceCaptions}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveSources}
        />
      )}
    </div>
  );
}
