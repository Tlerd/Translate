'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mic, Square, Volume2, BookOpen, Layers, Settings } from 'lucide-react';
import { useRecording } from './recording-context';
import styles from './recording-ui.module.css';

interface RecorderToolbarProps {
  onStart?: () => void;
  onStop?: () => void;
}

export function RecorderToolbar({ onStart, onStop }: RecorderToolbarProps) {
  const {
    controller,
    state,
    startRecording,
    stopRecording,
    switchMode,
  } = useRecording();

  const [pendingAction, setPendingAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isRecording = state.state === 'recording';

  const handleToggle = async () => {
    if (pendingAction) return;
    setPendingAction(isRecording ? 'stopping' : 'starting');
    setActionError(null);
    try {
      if (isRecording) {
        await stopRecording();
        onStop?.();
      } else {
        await startRecording({
          speechProvider: state.speechProvider,
          mode: state.mode,
          sourceLanguage: state.sourceLanguage,
          targetLanguage: state.targetLanguage,
          translationModelKey: state.translationModelKey,
          pauseMs: state.pauseMs,
          readingPauseMs: state.readingPauseMs,
        });
        onStart?.();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const getStatusPillClass = () => {
    if (state.speechState === 'listening') return styles.statusPillListening;
    if (state.speechState === 'reconnecting') return styles.statusPillReconnecting;
    if (isRecording) return styles.statusPillRecording;
    return styles.statusPillIdle;
  };

  return (
    <div className={`${styles.toolbar} ${isRecording ? styles.recordingToolbar : ''}`}>
      {/* Primary Clean Action Row */}
      <div className={styles.primaryActionRow}>
        <div className={styles.primaryActionsLeft}>
          {/* Main Action Button (Uiverse Galaxy style) */}
          <button
            onClick={handleToggle}
            disabled={pendingAction !== null}
            aria-busy={pendingAction !== null}
            className={`${styles.recordActionBtn} ${isRecording ? styles.recordBtnStop : styles.recordBtnStart}`}
          >
            {isRecording ? (
              <>
                <Square size={16} fill="#fff" />
                <span>{pendingAction === 'stopping' ? 'Đang kết thúc…' : 'Kết thúc buổi'}</span>
              </>
            ) : (
              <>
                <Mic size={17} />
                <span>{pendingAction === 'starting' ? 'Đang bắt đầu…' : 'Bắt đầu thu'}</span>
              </>
            )}
          </button>

          {/* Mode Switcher */}
          <div className={styles.modeSwitch}>
            <button
              type="button"
              onClick={() => switchMode('lecture')}
              className={`${styles.modeSwitchBtn} ${state.mode === 'lecture' ? styles.modeSwitchBtnActive : ''}`}
            >
              <BookOpen size={14} />
              <span>Giảng bài</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('readingPractice')}
              className={`${styles.modeSwitchBtn} ${state.mode === 'readingPractice' ? styles.modeSwitchBtnActive : ''}`}
            >
              <Layers size={14} />
              <span>Luyện đọc</span>
            </button>
          </div>
        </div>

        <div className={styles.primaryActionsRight}>
          {/* Volume Meter when recording */}
          {isRecording && (
            <div className={styles.volumeMeter}>
              <Volume2 size={15} color="var(--accent)" />
              <div
                role="progressbar"
                aria-label="Mức âm lượng micro"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.audioVolume * 100)}
                className={styles.volumeTrack}
              >
                <div
                  style={{
                    width: `${Math.round(state.audioVolume * 100)}%`,
                    height: '100%',
                    backgroundColor: 'var(--accent)',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
            </div>
          )}

          {/* Status Badge */}
          <div className={`${styles.statusPill} ${getStatusPillClass()}`}>
            {state.speechState === 'listening'
              ? 'Đang nhận giọng'
              : state.speechState === 'reconnecting'
              ? 'Đang kết nối lại mic...'
              : isRecording
              ? 'Đang thu'
              : 'Sẵn sàng'}
          </div>

          {/* Link to AI Settings */}
          <Link
            href="/settings"
            className={styles.configLinkBadge}
            title="Đến Cấu hình AI để đổi model, cách nhận giọng hoặc khoảng nghỉ"
          >
            <Settings size={14} />
            <span className={styles.configBadgeText}>Cấu hình AI</span>
          </Link>
        </div>
      </div>

      {actionError && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
          {actionError}
        </span>
      )}

      {/* Audio Diagnostics during recording */}
      {isRecording && (
        <div className={styles.audioDiagnostics} aria-live="polite" aria-label="Chẩn đoán âm thanh và nhận giọng">
          <span>
            Nhận giọng:{' '}
            {state.speechProvider === 'google'
              ? 'Gemini 3.5 Transcribe Live'
              : state.speechProvider === 'google-transcribe'
              ? 'Gemini 3.5 Transcribe'
              : 'Trình duyệt'}
          </span>
          <span title={state.micDeviceLabel ? `Thiết bị micro: ${state.micDeviceLabel}` : undefined}>
            Mic:{' '}
            {
              ({
                live: 'đang bật',
                muted: 'đang tắt',
                ended: 'đã ngắt',
                suspended: 'tạm dừng',
                idle: 'chưa bật',
              } as const)[state.micState]
            }
          </span>
          {state.speechProvider !== 'browser' && (
            <span>Audio PCM nhận: {Math.floor(state.receivedAudioMs / 1000)}s</span>
          )}
          <span>Kết quả nhận: {state.transcriptCount}</span>
          <span>
            Kết quả cuối:{' '}
            {state.lastTranscriptAt === null
              ? 'chưa có'
              : new Date(state.lastTranscriptAt).toLocaleTimeString()}
          </span>
          {state.translationLatencyMs !== null && <span>Dịch: {state.translationLatencyMs}ms</span>}
        </div>
      )}

      {isRecording && state.error && (
        <span role="alert" className={styles.toolbarError}>
          {state.error}
        </span>
      )}

      {isRecording && (state.micState === 'suspended' || state.micState === 'muted') && (
        <button
          type="button"
          onClick={() => void controller.resumeMicrophone()}
          className={styles.resumeMicButton}
        >
          Bật lại micro
        </button>
      )}

      {/* Speaker Assignment button when session has captions and is not recording */}
      {!isRecording && state.recordingId && state.captions.length > 0 && (
        <div className={styles.speakerAssignment} role="status">
          <button
            type="button"
            disabled={state.speakerStatus === 'working'}
            onClick={() => void controller.assignSpeakers()}
            className={styles.speakerButton}
            title="Phân biệt người nói dùng audio đã lưu trên máy; hỗ trợ tối đa 4 MB và 30 phút."
          >
            {state.speakerStatus === 'working'
              ? 'Đang phân biệt người nói…'
              : state.speakerStatus === 'done'
              ? 'Phân biệt lại người nói'
              : 'Phân biệt người nói'}
          </button>
          {state.speakerMessage && <span>{state.speakerMessage}</span>}
        </div>
      )}
    </div>
  );
}
