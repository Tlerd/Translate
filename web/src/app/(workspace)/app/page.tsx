'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRecording } from '@/features/recording/recording-context';
import { RecorderToolbar } from '@/features/recording/recorder-toolbar';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import { TranscriptPane } from '@/features/recording/transcript-pane';
import { FloatingRecorderPill } from '@/features/recording/floating-recorder-pill';
import type { RecordingItem } from '@/shared/recording';

function formatSessionTitle(date: Date = new Date()) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `note_${d}/${m} lúc ${hours} giờ ${minutes} phút`;
}

function WorkspaceContent() {
  const { state, controller } = useRecording();
  const searchParams = useSearchParams();
  const action = searchParams.get('action');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  useEffect(() => {
    if (action === 'new') {
      setIsCreatingNew(true);
    }
  }, [action]);

  const isRecording = state.state === 'recording';

  // When recording starts, exit creating new state
  useEffect(() => {
    if (isRecording) {
      setIsCreatingNew(false);
    }
  }, [isRecording]);

  const mockActiveRecording: RecordingItem = {
    id: state.recordingId || 'current',
    title: state.recordingId ? `Buổi học #${state.recordingId}` : 'Buổi học mới',
    createdAt: new Date().toISOString(),
    mode: state.mode,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    state: state.state,
    durationMs: state.durationMs,
    audioState: 'present',
    config: {
      translationModelKey: state.translationModelKey,
      transcriptionMode: state.transcriptionMode,
      speakerCount: state.speakerCount,
    },
  };

  // LilysAI Focus Recording Mode (Ảnh 093649.png & 093837.png)
  if (isRecording) {
    const title = formatSessionTitle();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {/* Central Focus Area */}
        <div
          style={{
            maxWidth: 780,
            width: '100%',
            margin: '0 auto',
            padding: '28px 20px 96px 20px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Big Session Title */}
          <h1
            style={{
              fontSize: '1.8rem',
              fontWeight: 700,
              textAlign: 'center',
              marginBottom: 28,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h1>

          {/* Real-time Bilingual Transcript Cards */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <TranscriptPane
              captions={state.captions}
              speakerCount={state.speakerCount}
              targetLanguage={state.targetLanguage}
              onSpeakerChange={(captionId, label) => controller.setCaptionSpeaker(captionId, label)}
            />
          </div>
        </div>

        {/* LilysAI Floating Dock Pill at the bottom */}
        <FloatingRecorderPill />
      </div>
    );
  }

  // Show top toolbar ONLY when creating new session OR when no recordings exist yet
  const showTopToolbar = isCreatingNew || state.captions.length === 0 || action === 'new';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {showTopToolbar && <RecorderToolbar />}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <RecordingWorkspace
          recording={mockActiveRecording}
          captions={state.captions}
          onSpeakerChange={(captionId, label) => controller.setCaptionSpeaker(captionId, label)}
          speakerAssignmentBusy={state.speakerStatus === 'working'}
          activeSegmentIndex={state.activeSegmentIndex}
        />
      </div>
    </div>
  );
}

export default function WorkspaceHomePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Đang tải...</div>}>
      <WorkspaceContent />
    </Suspense>
  );
}
