'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Pencil, Sparkles, Volume2 } from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { TranscriptEditorDialog } from './transcript-editor-dialog';
import { AudioSegmentsDialog } from './audio-segments-dialog';
import { SummaryPanel } from '@/features/summary/summary-panel';
import { ImagePanel } from '@/features/images/image-panel';
import { computeCaptionSourceHash, getAudioSegments, updateCaptionSources, updateCaptionSpeaker } from '@/storage/recordings';
import { normalizeSpeakerCount } from '@/shared/transcription';
import type { CaptionItem, SummaryItem, RecordingItem } from '@/shared/recording';
import styles from './recording-ui.module.css';

interface RecordingWorkspaceProps {
  recording: RecordingItem;
  captions: CaptionItem[];
  summary?: SummaryItem;
  onSummaryUpdated?: (summary: SummaryItem) => void;
  onSpeakerChange?: (captionId: number, speakerLabel: string | undefined) => Promise<void>;
  speakerAssignmentBusy?: boolean;
  activeSegmentIndex?: number;
}

export function RecordingWorkspace({
  recording,
  captions,
  summary: initialSummary,
  onSummaryUpdated,
  onSpeakerChange,
  speakerAssignmentBusy = false,
  activeSegmentIndex,
}: RecordingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [summary, setSummary] = useState<SummaryItem | undefined>(initialSummary);
  const [workspaceCaptions, setWorkspaceCaptions] = useState(captions);
  const [highlightCaptionId, setHighlightCaptionId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [segmentsDialogOpen, setSegmentsDialogOpen] = useState(false);
  const [segmentsCount, setSegmentsCount] = useState(0);
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

  // Query audio segments count
  useEffect(() => {
    let active = true;
    if (recording.id) {
      getAudioSegments(recording.id)
        .then((segs) => {
          if (active) setSegmentsCount(segs.length);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [recording.id, activeSegmentIndex, recordingInProgress]);

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

  const speakerCount = normalizeSpeakerCount(recording.config.speakerCount ?? 8);
  const handleSpeakerChange = async (captionId: number, speakerLabel: string | undefined) => {
    if (onSpeakerChange) await onSpeakerChange(captionId, speakerLabel);
    else await updateCaptionSpeaker(recording.id, captionId, speakerLabel, speakerCount);
    setWorkspaceCaptions(previous => previous.map(caption => caption.id === captionId ? { ...caption, speakerLabel } : caption));
  };

  return (
    <div className={styles.workspace}>
      {/* Tab bar */}
      <div className={styles.workspaceTabs}>
        <div className={styles.tabPillContainer}>
          <button
            type="button"
            onClick={() => setActiveTab('transcript')}
            className={`${styles.tabPill} ${activeTab === 'transcript' ? styles.tabPillActive : ''}`}
          >
            <FileText size={15} />
            <span>Bản dịch ({workspaceCaptions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`${styles.tabPill} ${activeTab === 'summary' ? styles.tabPillActive : ''}`}
          >
            <Sparkles size={15} />
            <span>Tóm tắt {summary ? '✓' : ''}</span>
          </button>

          {/* Audio Segments button */}
          {(recording.audioState === 'present' || recordingInProgress || segmentsCount > 0) && (
            <button
              type="button"
              onClick={() => setSegmentsDialogOpen(true)}
              className={styles.tabPill}
              title="Danh sách các đoạn ghi âm, nghe lại và tải về"
            >
              <Volume2 size={15} />
              <span>Ghi âm {segmentsCount > 0 ? `(${segmentsCount})` : ''}</span>
            </button>
          )}
        </div>

        {activeTab === 'transcript' && workspaceCaptions.length > 0 && (
          <div className={recordingInProgress ? styles.recordingTools : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
      </div>

      {/* Main View Area */}
      <div className={styles.workspaceContent}>
        {activeTab === 'transcript' ? (
          <TranscriptPane
            captions={workspaceCaptions}
            highlightCaptionId={highlightCaptionId}
            speakerCount={speakerCount}
            onSpeakerChange={!recordingInProgress && !speakerAssignmentBusy ? handleSpeakerChange : undefined}
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
      {segmentsDialogOpen && (
        <AudioSegmentsDialog
          recordingId={recording.id}
          isRecording={recordingInProgress}
          onClose={() => {
            setSegmentsDialogOpen(false);
            if (recording.id) {
              getAudioSegments(recording.id)
                .then((segs) => setSegmentsCount(segs.length))
                .catch(() => undefined);
            }
          }}
        />
      )}
    </div>
  );
}
