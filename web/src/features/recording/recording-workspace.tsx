'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, FileText, Maximize2, Pencil, Sparkles, Volume2, Columns2 } from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { ReadingMode } from './reading-mode';
import { useReadingPrefs } from './use-reading-prefs';
import { TranscriptEditorDialog } from './transcript-editor-dialog';
import { AudioSegmentsDialog } from './audio-segments-dialog';
import { SummaryPanel } from '@/features/summary/summary-panel';
import { ImagePanel } from '@/features/images/image-panel';
import { computeCaptionSourceHash, updateCaptionSources, updateCaptionSpeaker } from '@/storage/recordings';
import { normalizeSpeakerCount } from '@/shared/transcription';
import type { CaptionItem, SummaryItem, RecordingItem } from '@/shared/recording';
import styles from './recording-ui.module.css';

const SPLIT_COLLAPSE_KEY = 'split_view_collapsed';
type PanelName = 'transcript' | 'summary';
type CollapsedPanels = Record<PanelName, boolean>;

interface RecordingWorkspaceProps {
  recording: RecordingItem;
  captions: CaptionItem[];
  summary?: SummaryItem;
  onSummaryUpdated?: (summary: SummaryItem) => void;
  onSpeakerChange?: (captionId: number, speakerLabel: string | undefined) => Promise<void>;
  speakerAssignmentBusy?: boolean;
  activeSegmentIndex?: number;
  /** Rendered at the left of the single top row (the recording detail header). */
  header?: React.ReactNode;
}

export function RecordingWorkspace({
  recording,
  captions,
  summary: initialSummary,
  onSummaryUpdated,
  onSpeakerChange,
  speakerAssignmentBusy = false,
  header,
}: RecordingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');
  const [viewMode, setViewMode] = useState<'split' | 'tabs'>('split');
  const [splitPercent, setSplitPercent] = useState<number>(48);
  const [collapsed, setCollapsed] = useState<CollapsedPanels>({ transcript: false, summary: false });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<SummaryItem | undefined>(initialSummary);
  const [workspaceCaptions, setWorkspaceCaptions] = useState(captions);
  const [highlightCaptionId, setHighlightCaptionId] = useState<number | null>(null);
  const reading = useReadingPrefs();
  const [editorOpen, setEditorOpen] = useState(false);
  const [segmentsDialogOpen, setSegmentsDialogOpen] = useState(false);
  const [currentSourceHash, setCurrentSourceHash] = useState<string | null>(null);
  const recordingInProgress = recording.state === 'recording';
  const summaryIsStale = Boolean(summary && currentSourceHash && summary.sourceHash !== currentSourceHash);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('split_view_percent');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 25 && parsed <= 75) {
          setSplitPercent(parsed);
        }
      }
    } catch {
      // ignore
    }
    try {
      const savedCollapse = localStorage.getItem(SPLIT_COLLAPSE_KEY);
      if (savedCollapse) {
        const parsed = JSON.parse(savedCollapse) as Partial<CollapsedPanels>;
        const next = { transcript: parsed.transcript === true, summary: parsed.summary === true };
        // One panel always stays open.
        if (!(next.transcript && next.summary)) setCollapsed(next);
      }
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('tabs');
    }
  }, []);

  const setPanelCollapsed = (panel: PanelName, value: boolean) => {
    const next: CollapsedPanels = { ...collapsed, [panel]: value };
    if (next.transcript && next.summary) return;
    setCollapsed(next);
    try {
      localStorage.setItem(SPLIT_COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleTouchStart = () => {
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawPct = ((clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(75, Math.max(25, rawPct));
      setSplitPercent(clamped);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handlePointerMove(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        handlePointerMove(e.touches[0].clientX);
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      try {
        localStorage.setItem('split_view_percent', String(splitPercent));
      } catch {
        // ignore
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging, splitPercent]);

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
    if (collapsed.transcript) setPanelCollapsed('transcript', false);
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
      {/* Single top row: page header (left), view tools (right) */}
      <div className={styles.workspaceTabs}>
        {header}

        <div className={styles.workspaceActions}>
          <div className={styles.tabPillContainer}>
            {viewMode === 'tabs' && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('transcript')}
                  className={`${styles.tabPill} ${activeTab === 'transcript' ? styles.tabPillActive : ''}`}
                >
                  <FileText size={15} />
                  <span>Bản gốc ({workspaceCaptions.length})</span>
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

          {!recordingInProgress && (
            <button
              type="button"
              onClick={() => setViewMode(v => v === 'split' ? 'tabs' : 'split')}
              className={styles.tabPill}
              title={viewMode === 'split' ? "Chuyển sang dạng tab" : "Chuyển sang dạng song song 2 cột"}
              aria-label={viewMode === 'split' ? 'Dạng Tab' : 'Song song'}
              style={{ fontSize: '0.8rem' }}
            >
              <Columns2 size={14} />
              <span className={styles.actionLabel}>{viewMode === 'split' ? 'Dạng Tab' : 'Song song'}</span>
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

          {!recordingInProgress && workspaceCaptions.length > 0 && (
            <button
              type="button"
              onClick={reading.enter}
              className={styles.tabPill}
              title="Đọc toàn màn hình, ẩn mọi thanh công cụ"
              aria-label="Đọc toàn màn hình"
              style={{ fontSize: '0.8rem' }}
            >
              <Maximize2 size={14} />
              <span className={styles.actionLabel}>Đọc toàn màn hình</span>
            </button>
          )}
        </div>
      </div>

      {/* Main View Area */}
      <div className={styles.workspaceContent}>
        {viewMode === 'split' && !recordingInProgress ? (
          /* Split view: two panels, each with a thin header and its own collapse control */
          <div
            ref={containerRef}
            className={styles.splitContainer}
            style={{ userSelect: isDragging ? 'none' : 'auto' }}
          >
            {/* Left: Transcript (Bản gốc) */}
            {collapsed.transcript ? (
              <button
                type="button"
                className={`${styles.collapsedRail} ${styles.collapsedRailLeft}`}
                onClick={() => setPanelCollapsed('transcript', false)}
                title="Hiện bản gốc"
                aria-label="Hiện bản gốc"
              >
                <ChevronsRight size={16} />
              </button>
            ) : (
              <div
                className={styles.splitPanel}
                style={collapsed.summary
                  ? { flex: '1 1 0' }
                  : { width: `${splitPercent}%`, minWidth: 260, flex: '0 0 auto' }}
              >
                <div className={styles.panelBar}>
                  <button
                    type="button"
                    className={styles.panelCollapseBtn}
                    onClick={() => setPanelCollapsed('transcript', true)}
                    disabled={collapsed.summary}
                    title={collapsed.summary ? 'Mở tóm tắt trước khi thu gọn bản gốc' : 'Thu gọn bản gốc'}
                    aria-label="Thu gọn bản gốc"
                  >
                    <ChevronsLeft size={15} />
                  </button>
                  <span className={styles.panelBarLabel}>Bản gốc ({workspaceCaptions.length})</span>
                </div>
                <div className={`${styles.panelBody} ${collapsed.summary ? styles.paneFull : ''}`}>
                  <TranscriptPane
                    captions={workspaceCaptions}
                    highlightCaptionId={highlightCaptionId}
                    speakerCount={speakerCount}
                    targetLanguage={recording.targetLanguage}
                    onSpeakerChange={!recordingInProgress && !speakerAssignmentBusy ? handleSpeakerChange : undefined}
                    startAtTop={!recordingInProgress}
                  />
                </div>
              </div>
            )}

            {/* Resizable Divider (only while both panels are open) */}
            {!collapsed.transcript && !collapsed.summary && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                title="Kéo sang hai bên để điều chỉnh tỷ lệ hiển thị (25% - 75%)"
                className={styles.splitDivider}
                data-dragging={isDragging ? 'true' : undefined}
              />
            )}

            {/* Right: AI Summary Workspace (Tóm tắt) */}
            {collapsed.summary ? (
              <button
                type="button"
                className={`${styles.collapsedRail} ${styles.collapsedRailRight}`}
                onClick={() => setPanelCollapsed('summary', false)}
                title="Hiện tóm tắt"
                aria-label="Hiện tóm tắt"
              >
                <ChevronsLeft size={16} />
              </button>
            ) : (
              <div
                className={styles.splitPanel}
                style={{ flex: '1 1 0', minWidth: collapsed.transcript ? 0 : 260 }}
              >
                <div className={`${styles.panelBar} ${styles.panelBarEnd}`}>
                  <button
                    type="button"
                    className={styles.panelCollapseBtn}
                    onClick={() => setPanelCollapsed('summary', true)}
                    disabled={collapsed.transcript}
                    title={collapsed.transcript ? 'Mở bản gốc trước khi thu gọn tóm tắt' : 'Thu gọn tóm tắt'}
                    aria-label="Thu gọn tóm tắt"
                  >
                    <ChevronsRight size={15} />
                  </button>
                </div>
                <div className={styles.panelScroll}>
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
                  {summary && currentSourceHash === summary.sourceHash && (
                    <div className={styles.calmArea}>
                      <ImagePanel recordingId={recording.id} summary={summary} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'transcript' ? (
          <TranscriptPane
            captions={workspaceCaptions}
            highlightCaptionId={highlightCaptionId}
            speakerCount={speakerCount}
            targetLanguage={recording.targetLanguage}
            onSpeakerChange={!recordingInProgress && !speakerAssignmentBusy ? handleSpeakerChange : undefined}
            startAtTop={!recordingInProgress}
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
            {summary && currentSourceHash === summary.sourceHash && (
              <div className={styles.calmArea}>
                <ImagePanel recordingId={recording.id} summary={summary} />
              </div>
            )}
          </div>
        )}
      </div>
      {reading.open && (
        <ReadingMode
          title={recording.title}
          scale={reading.scale}
          display={reading.display}
          hasTranslation={recording.targetLanguage !== 'none' && workspaceCaptions.some((caption) => caption.translation)}
          onScale={reading.changeScale}
          onDisplay={reading.changeDisplay}
          onExit={reading.exit}
        >
          <TranscriptPane
            captions={workspaceCaptions}
            highlightCaptionId={highlightCaptionId}
            speakerCount={speakerCount}
            targetLanguage={recording.targetLanguage}
            reading={{ scale: reading.scale, display: reading.display }}
          />
        </ReadingMode>
      )}
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
