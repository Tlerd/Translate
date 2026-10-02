'use client';

import React from 'react';
import { useRecording } from '@/features/recording/recording-context';
import { RecorderToolbar } from '@/features/recording/recorder-toolbar';
import { RecordingWorkspace } from '@/features/recording/recording-workspace';
import type { RecordingItem } from '@/shared/recording';

export default function WorkspaceHomePage() {
  const { state, controller } = useRecording();

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
      transcriptionMode: state.transcriptionMode,
      speakerCount: state.speakerCount,
    },
  };

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
