'use client';

import React from 'react';
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

export default function WorkspaceHomePage() {
  const { state, controller } = useRecording();
  const isRecording = state.state === 'recording';

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

  // Normal Setup & Replay Mode
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <RecorderToolbar />
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
