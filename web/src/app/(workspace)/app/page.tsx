'use client';

import React from 'react';
import { useRecording } from '@/features/recording/recording-context';
import { RecorderToolbar } from '@/features/recording/recorder-toolbar';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import type { RecordingItem } from '@/shared/recording';

export default function WorkspaceHomePage() {
  const { state } = useRecording();

  const mockActiveRecording: RecordingItem = {
    id: state.recordingId || 'current',
    title: state.recordingId ? `Buổi học đang thu (#${state.recordingId})` : 'Buổi học mới',
    createdAt: new Date().toISOString(),
    mode: state.mode,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    state: state.state,
    durationMs: state.durationMs,
    audioState: 'present',
    config: {
      translationModelKey: state.translationModelKey,
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <RecorderToolbar />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RecordingWorkspace
          recording={mockActiveRecording}
          captions={state.captions}
        />
      </div>
    </div>
  );
}
