'use client';

import React, { useState } from 'react';
import { Mic, Square, Volume2, BookOpen, MessageSquare, Pause, Play, AlertTriangle, ArrowLeftRight, Info } from 'lucide-react';
import { useRecording } from './recording-context';
import styles from './recording-ui.module.css';
import { LanguageSelect } from './language-select';
import languageStyles from './language-select.module.css';
import { inputLanguages, inputLanguage, OUTPUT_LANGUAGES } from '@/shared/languages';
import { speechProviderName } from '@/shared/transcription';

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
    pauseApi,
    resumeApi,
    switchMode,
    setLanguages,
    swapLanguages,
  } = useRecording();

  const [pendingAction, setPendingAction] = useState<'starting' | 'stopping' | 'pausing' | 'resuming' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const isRecording = state.state === 'recording';

  const handleStart = async () => {
    if (pendingAction) return;
    setPendingAction('starting');
    setActionError(null);
    try {
      await startRecording({
        speechProvider: state.speechProvider,
        transcriptionMode: state.transcriptionMode,
        speakerCount: state.speakerCount,
        mode: state.mode,
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        translationModelKey: state.translationModelKey,
        pauseMs: state.pauseMs,
        readingPauseMs: state.readingPauseMs,
      });
      onStart?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handlePauseApi = async () => {
    if (pendingAction) return;
    setPendingAction('pausing');
    setActionError(null);
    try {
      await pauseApi();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleResumeApi = async () => {
    if (pendingAction) return;
    setPendingAction('resuming');
    setActionError(null);
    try {
      await resumeApi();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirmStop = async () => {
    setShowEndConfirm(false);
    if (pendingAction) return;
    setPendingAction('stopping');
    setActionError(null);
    try {
      await stopRecording();
      onStop?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const getStatusPillClass = () => {
    if (state.apiState === 'paused') return styles.statusPillReconnecting;
    if (state.speechState === 'listening') return styles.statusPillListening;
    if (state.speechState === 'reconnecting') return styles.statusPillReconnecting;
    if (isRecording) return styles.statusPillRecording;
    return styles.statusPillIdle;
  };

  return (
    <div className={`${styles.toolbar} ${isRecording ? styles.recordingToolbar : ''}`}>
      <div className={languageStyles.row}>
        <LanguageSelect
          label="Ngôn ngữ đầu vào"
          value={inputLanguage(state.sourceLanguage, state.speechProvider) ?? state.sourceLanguage}
          options={inputLanguages(state.speechProvider)}
          disabled={isRecording || pendingAction !== null}
          onChange={code => setLanguages(code, state.targetLanguage)}
        />
        <button
          type="button"
          className={languageStyles.swap}
          aria-label="Đổi chiều ngôn ngữ"
          title={isRecording ? "Hoán đổi ngôn ngữ đầu vào và đầu ra" : "Đổi chiều ngôn ngữ"}
          disabled={
            pendingAction !== null ||
            state.targetLanguage === 'none' ||
            !inputLanguage(state.targetLanguage, state.speechProvider)
          }
          onClick={async () => {
            if (isRecording) {
              await swapLanguages();
            } else {
              setLanguages(state.targetLanguage, state.sourceLanguage);
            }
          }}
        >
          <ArrowLeftRight size={18} />
        </button>
        <LanguageSelect
          label="Ngôn ngữ đầu ra"
          value={state.targetLanguage}
          options={OUTPUT_LANGUAGES}
          disabled={pendingAction !== null}
          onChange={code => setLanguages(state.sourceLanguage, code)}
        />
      </div>
      {/* Primary Clean Action Row */}
      <div className={styles.primaryActionRow}>
        <div className={styles.primaryActionsLeft}>
          {/* Main Action Buttons */}
          {!isRecording ? (
            <button
              onClick={handleStart}
              disabled={pendingAction !== null}
              aria-busy={pendingAction !== null}
              className={`${styles.recordActionBtn} ${styles.recordBtnStart}`}
            >
              <Mic size={17} />
              <span>{pendingAction === 'starting' ? 'Đang bắt đầu…' : 'Bắt đầu thu'}</span>
            </button>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {/* Pause / Resume API Button */}
              {state.apiState === 'paused' || state.apiState === 'resuming' ? (
                <button
                  type="button"
                  onClick={handleResumeApi}
                  disabled={pendingAction !== null || state.apiState === 'resuming'}
                  className={`${styles.recordActionBtn} ${styles.recordBtnResume}`}
                  title="Tiếp tục nhận giọng và dịch; ghi âm toàn buổi vẫn liên tục"
                >
                  <Play size={16} fill="#fff" />
                  <span>{pendingAction === 'resuming' || state.apiState === 'resuming' ? 'Đang tiếp tục…' : 'Tiếp tục'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePauseApi}
                  disabled={pendingAction !== null || state.apiState === 'pausing'}
                  className={`${styles.recordActionBtn} ${styles.recordBtnPause}`}
                  title="Dừng gửi âm thanh mới tới API; các câu đã nhận tiếp tục dịch, ghi âm vẫn tiếp tục"
                >
                  <Pause size={16} fill="#fff" />
                  <span>{pendingAction === 'pausing' || state.apiState === 'pausing' ? 'Đang dừng…' : 'Dừng API'}</span>
                </button>
              )}

              {/* Confirm Stop Button */}
              <button
                type="button"
                onClick={() => setShowEndConfirm(true)}
                disabled={pendingAction !== null}
                className={`${styles.recordActionBtn} ${styles.recordBtnStop}`}
                title="Kết thúc buổi học và chốt audio"
              >
                <Square size={15} fill="#fff" />
                <span>{pendingAction === 'stopping' ? 'Đang kết thúc…' : 'Kết thúc buổi'}</span>
              </button>
            </div>
          )}

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
              <MessageSquare size={14} />
              <span>Hội thoại</span>
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
            {state.apiState === 'paused'
              ? 'Đã dừng API · vẫn ghi âm'
              : state.apiState === 'pausing'
              ? 'Đang dừng API…'
              : state.apiState === 'resuming'
              ? 'Đang tiếp tục…'
              : state.speechState === 'listening'
              ? 'Đang nhận giọng'
              : state.speechState === 'reconnecting'
              ? 'Đang kết nối lại mic...'
              : isRecording
              ? 'Đang thu'
              : 'Sẵn sàng'}
          </div>

          {/* Toggle Diagnostics Button */}
          {isRecording && (
            <button
              type="button"
              onClick={() => setShowDiagnostics((prev) => !prev)}
              className={styles.diagToggleBtn}
              title={showDiagnostics ? 'Ẩn thông số kỹ thuật' : 'Xem thông số kỹ thuật'}
              aria-pressed={showDiagnostics}
            >
              <Info size={13} />
              <span>{showDiagnostics ? 'Ẩn thông số' : 'Thông số'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Ending Session */}
      {showEndConfirm && (
        <div
          className={styles.confirmOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-end-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowEndConfirm(false); }}
        >
          <div className={styles.confirmDialog}>
            <div id="confirm-end-title" className={styles.confirmTitle}>
              <AlertTriangle size={20} color="var(--warning)" />
              <span>Xác nhận kết thúc buổi học?</span>
            </div>
            <div className={styles.confirmMessage}>
              Buổi học đã đóng sẽ không thể thu tiếp. Audio toàn buổi và bản dịch được lưu trên máy, sau đó tự đồng bộ khi có mạng.
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={() => setShowEndConfirm(false)}
                disabled={pendingAction === 'stopping'}
              >
                Hủy
              </button>
              <button
                type="button"
                className={styles.confirmSubmitBtn}
                onClick={handleConfirmStop}
                disabled={pendingAction === 'stopping'}
                autoFocus
              >
                {pendingAction === 'stopping' ? 'Đang lưu…' : 'Kết thúc và lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
          {actionError}
        </span>
      )}

      {/* Audio Diagnostics during recording */}
      {isRecording && showDiagnostics && (
        <div className={styles.audioDiagnostics} aria-live="polite" aria-label="Chẩn đoán âm thanh và nhận giọng">
          <span>
            Nhận giọng:{' '}
            {speechProviderName(state.speechProvider)}{state.speechProvider === 'google-flash-live' ? '' : ` · ${state.transcriptionMode}`}
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
          <span className={styles.diagnosticDetail}>Audio PCM nhận: {Math.floor(state.receivedAudioMs / 1000)}s</span>
          <span>{state.speakerCount} người nói</span>
          <span className={styles.diagnosticDetail}>Kết quả nhận: {state.transcriptCount}</span>
          <span className={styles.diagnosticDetail}>
            Kết quả cuối:{' '}
            {state.lastTranscriptAt === null
              ? 'chưa có'
              : new Date(state.lastTranscriptAt).toLocaleTimeString()}
          </span>
          {state.translationLatencyMs !== null && <span className={styles.diagnosticDetail}>Dịch: {state.translationLatencyMs}ms</span>}
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
          {state.transcriptionMode === 'verbatim' ? <button
            type="button"
            disabled={state.speakerStatus === 'working'}
            onClick={() => void controller.assignSpeakers()}
            className={styles.speakerButton}
            title="Phân biệt lại toàn buổi bằng Gemini Transcribe để thống nhất nhãn giữa các đoạn; tối đa 4 MB và 30 phút, phát sinh thêm một lượt API."
          >
            {state.speakerStatus === 'working'
              ? 'Đang phân biệt người nói…'
              : 'Phân biệt lại người nói'}
          </button> : <span>Smart: gán Speaker cho từng câu trong bản dịch.</span>}
          {state.speakerMessage && <span>{state.speakerMessage}</span>}
        </div>
      )}
    </div>
  );
}
