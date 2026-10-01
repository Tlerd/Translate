'use client';

import React, { useEffect, useState } from 'react';
import { Mic, Square, Volume2, BookOpen, Layers, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { useRecording } from './recording-context';
import { fetchModels } from '@/lib/api-client';
import type { ModelInfo } from '@/shared/ai-contracts';
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
    setSpeechProvider,
    setTranslationModel,
    setTranslationThinkingLevel,
    setPauseMs,
    setReadingPauseMs,
  } = useRecording();

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [pendingAction, setPendingAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mobileConfigOpen, setMobileConfigOpen] = useState(false);

  useEffect(() => {
    fetchModels()
      .then((data) => {
        const order = [
          'google:gemini-3.1-flash-lite',
          'google:gemini-2.5-flash-lite',
          'google:gemini-3.5-flash-lite',
          'openai:gpt-4o-mini',
        ];
        const transModels = data.models
          .filter((m) => m.allowedTasks.includes('translate') && m.enabled)
          .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        setAvailableModels(transModels);
      })
      .catch((err) => console.warn('Lỗi lấy danh mục model:', err));
  }, []);

  const isRecording = state.state === 'recording';

  // Automatically collapse config drawer on mobile when recording begins
  useEffect(() => {
    if (isRecording) {
      setMobileConfigOpen(false);
    }
  }, [isRecording]);

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

  const selectedModel = availableModels.find((model) => model.key === state.translationModelKey);
  const thinkingLevels = selectedModel?.thinkingLevels ?? [];

  return (
    <div className={`${styles.toolbar} ${isRecording ? styles.recordingToolbar : ''}`}>
      {/* Primary Action Row: always clean & visible on desktop & mobile */}
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

          {/* Mobile Config Drawer Toggle */}
          <button
            type="button"
            className={`${styles.mobileConfigToggle} ${mobileConfigOpen ? styles.mobileConfigToggleOpen : ''}`}
            onClick={() => setMobileConfigOpen(!mobileConfigOpen)}
            title="Cấu hình nhận giọng và model"
            aria-expanded={mobileConfigOpen}
          >
            <SlidersHorizontal size={14} />
            <span>Tùy chọn</span>
            {mobileConfigOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {actionError && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
          {actionError}
        </span>
      )}

      {/* Config Section (Horizontal on desktop, Collapsible card on mobile) */}
      <div className={`${styles.configSection} ${mobileConfigOpen ? styles.configSectionOpen : ''}`}>
        {/* Speech Provider */}
        <div className={styles.speechSettings}>
          <label htmlFor="speech-provider">Nhận giọng:</label>
          <select
            id="speech-provider"
            value={state.speechProvider}
            onChange={(event) =>
              setSpeechProvider(event.target.value as 'google' | 'google-transcribe' | 'browser')
            }
            disabled={isRecording}
          >
            <option value="google">Gemini 3.5 Transcribe Live · trực tiếp</option>
            <option value="google-transcribe">Gemini 3.5 Transcribe · theo đoạn</option>
            <option value="browser">Trình duyệt</option>
          </select>
        </div>

        {/* Translation Model */}
        <div className={styles.modelSettings}>
          <label htmlFor="translation-model">Model dịch:</label>
          <select
            id="translation-model"
            value={state.translationModelKey}
            onChange={(e) => {
              const nextKey = e.target.value;
              setTranslationModel(nextKey);
              const nextModel = availableModels.find((model) => model.key === nextKey);
              if (
                state.translationThinkingLevel !== 'auto' &&
                !nextModel?.thinkingLevels?.includes(
                  state.translationThinkingLevel as 'minimal' | 'low' | 'medium' | 'high'
                )
              ) {
                setTranslationThinkingLevel('auto');
              }
            }}
            disabled={isRecording}
          >
            {availableModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
                {!m.configured ? ' (Chưa có key)' : ''}
              </option>
            ))}
            {availableModels.length === 0 && (
              <option value="google:gemini-3.1-flash-lite">
                Gemini 3.1 Flash-Lite · $0.25/$1.50 / 1M token
              </option>
            )}
          </select>

          {thinkingLevels.length > 0 && (
            <>
              <label htmlFor="translation-thinking">Suy luận:</label>
              <select
                id="translation-thinking"
                value={state.translationThinkingLevel}
                onChange={(e) => setTranslationThinkingLevel(e.target.value)}
                disabled={isRecording}
              >
                <option value="auto">Tự động</option>
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {
                      ({
                        minimal: 'Tối thiểu',
                        low: 'Thấp',
                        medium: 'Vừa',
                        high: 'Cao',
                      } as const)[level]
                    }
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Pause range slider */}
        <label className={styles.pauseSetting}>
          <span>Khoảng nghỉ để chốt câu</span>
          <input
            type="range"
            min={600}
            max={state.mode === 'lecture' ? 2000 : 10000}
            step={100}
            value={state.mode === 'lecture' ? state.pauseMs : state.readingPauseMs}
            onChange={(event) => {
              const milliseconds = Number(event.target.value);
              if (state.mode === 'lecture') setPauseMs(milliseconds);
              else setReadingPauseMs(milliseconds);
            }}
            aria-label="Khoảng nghỉ để chốt câu, giây"
            className={styles.pauseSlider}
          />
          <output style={{ minWidth: 28, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {((state.mode === 'lecture' ? state.pauseMs : state.readingPauseMs) / 1000).toFixed(1)}s
          </output>
        </label>

        {/* Pricing details */}
        {state.speechProvider !== 'browser' && (
          <details className={styles.pricingDetails}>
            <summary>
              {state.speechProvider === 'google'
                ? 'Trực tiếp · 5 giờ nhận giọng ≈ 2,70 USD'
                : 'Theo đoạn · 5 giờ nhận giọng ≈ 1,50 USD'}{' '}
              — xem phí dịch
            </summary>
            <p style={{ margin: '6px 0', whiteSpace: 'normal' }}>
              {state.speechProvider === 'google'
                ? 'Chữ trực tiếp.'
                : 'Chữ sau mỗi đoạn nghỉ, tối đa 15 giây + thời gian API.'}{' '}
              Ví dụ dịch bằng Gemini 3.1 Flash-Lite với tổng 100.000 token vào + 100.000 token ra: thêm ≈ 0,175 USD (5 giờ nhận giọng + dịch ≈ 2,88 USD Live / 1,68 USD theo đoạn). Chưa gồm tóm tắt, ảnh, phân người nói và các lượt dịch lại.{' '}
              <a
                href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline' }}
              >
                Bảng giá Google
              </a>
            </p>
          </details>
        )}

        {/* Audio Diagnostics & Diarization */}
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
    </div>
  );
}
