'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Pencil, Sparkles, Volume2, Columns2 } from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { TranscriptEditorDialog } from './transcript-editor-dialog';
import { AudioSegmentsDialog } from './audio-segments-dialog';
import { SummaryPanel } from '@/features/summary/summary-panel';
import { ImagePanel } from '@/features/images/image-panel';
import { computeCaptionSourceHash, updateCaptionSources, updateCaptionSpeaker } from '@/storage/recordings';
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
}: RecordingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [viewMode, setViewMode] = useState<'split' | 'tabs'>('split');
  const [summary, setSummary] = useState<SummaryItem | undefined>(initialSummary);
  const [workspaceCaptions, setWorkspaceCaptions] = useState(captions);
  const [highlightCaptionId, setHighlightCaptionId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [segmentsDialogOpen, setSegmentsDialogOpen] = useState(false);
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

  const handleSelectCaption = (captionId: number) => {
    if (viewMode === 'tabs') setActiveTab('transcript');
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
      {/* Workspace Header / Tab Bar */}
      <div className={styles.workspaceTabs}>
        <div className={styles.tabPillContainer}>
          {viewMode === 'tabs' ? (
            <>
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
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              <span>Chế độ song song (Split-View)</span>
            </div>
          )}

          {/* Audio Segments button */}
          {(recording.audioState !== 'deleted') && (
            <button
              type="button"
              onClick={() => setSegmentsDialogOpen(true)}
              className={styles.tabPill}
              title="Nghe hoặc tải bản ghi toàn buổi"
            >
              <Volume2 size={15} />
              <span>Ghi âm</span>
            </button>
          )}
        </div>

        {/* Right action tools: Split-View Toggle & Edit script */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!recordingInProgress && (
            <button
              type="button"
              onClick={() => setViewMode(v => v === 'split' ? 'tabs' : 'split')}
              className={styles.tabPill}
              title={viewMode === 'split' ? "Chuyển sang dạng tab" : "Chuyển sang dạng song song 2 cột"}
              style={{ fontSize: '0.8rem' }}
            >
              <Columns2 size={14} />
              <span>{viewMode === 'split' ? 'Dạng Tab' : 'Song song'}</span>
            </button>
          )}

          {((viewMode === 'tabs' && activeTab === 'transcript') || viewMode === 'split') && workspaceCaptions.length > 0 && (
            <div className={recordingInProgress ? styles.recordingTools : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                disabled={recordingInProgress}
                title={recordingInProgress ? 'Không thể chỉnh sửa khi buổi thu đang chạy' : 'Chỉnh sửa kịch bản'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 9px',
                  color: recordingInProgress ? 'var(--text-muted)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  opacity: recordingInProgress ? 0.55 : 1,
                  background: 'var(--bg-card)',
                  cursor: recordingInProgress ? 'not-allowed' : 'pointer',
                }}
              >
                <Pencil size={13} /> Sửa kịch bản
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main View Area */}
      <div className={styles.workspaceContent}>
        {viewMode === 'split' && !recordingInProgress ? (
          /* LilysAI Split-View Two Columns */
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.2fr)', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            {/* Left: Transcript */}
            <div style={{ borderRight: '1px solid var(--border-color)', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <TranscriptPane
                captions={workspaceCaptions}
                highlightCaptionId={highlightCaptionId}
                speakerCount={speakerCount}
                targetLanguage={recording.targetLanguage}
                onSpeakerChange={!recordingInProgress && !speakerAssignmentBusy ? handleSpeakerChange : undefined}
              />
            </div>

            {/* Right: AI Summary Workspace */}
            <div style={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
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
          </div>
        ) : activeTab === 'transcript' ? (
          <TranscriptPane
            captions={workspaceCaptions}
            highlightCaptionId={highlightCaptionId}
            speakerCount={speakerCount}
            targetLanguage={recording.targetLanguage}
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
          }}
        />
      )}
    </div>
  );
}
