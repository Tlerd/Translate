'use client';

import React, { useEffect, useState } from 'react';
import { Mic, Square, Volume2, BookOpen, Layers } from 'lucide-react';
import { useRecording } from './recording-context';
import { fetchModels } from '@/lib/api-client';
import type { ModelInfo } from '@/shared/ai-contracts';
import styles from './recording-ui.module.css';

interface RecorderToolbarProps {
  onStart?: () => void;
  onStop?: () => void;
}

export function RecorderToolbar({ onStart, onStop }: RecorderToolbarProps) {
  const { controller, state, startRecording, stopRecording, switchMode, setSpeechProvider, setTranslationModel, setTranslationThinkingLevel, setPauseMs, setReadingPauseMs } = useRecording();

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [pendingAction, setPendingAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels()
      .then((data) => {
        const order = ['google:gemini-3.1-flash-lite', 'google:gemini-2.5-flash-lite', 'google:gemini-3.5-flash-lite', 'openai:gpt-4o-mini'];
        const transModels = data.models.filter((m) => m.allowedTasks.includes('translate') && m.enabled)
          .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        setAvailableModels(transModels);
      })
      .catch((err) => console.warn('Lỗi lấy danh mục model:', err));
  }, []);

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

  return (
    <div
      className={`${styles.toolbar} ${isRecording ? styles.recordingToolbar : ''}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        gap: 12,
      }}
    >
      <div className={styles.toolbarControls} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {/* Main Action Button */}
        <button
          onClick={handleToggle}
          disabled={pendingAction !== null}
          aria-busy={pendingAction !== null}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            backgroundColor: isRecording ? 'var(--danger)' : 'var(--success)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '0.95rem',
            boxShadow: isRecording
              ? '0 0 12px rgba(239, 68, 68, 0.4)'
              : '0 0 12px rgba(34, 197, 94, 0.4)',
            transition: 'all 0.2s',
          }}
          className={styles.recordAction}
        >
          {isRecording ? (
            <>
              <Square size={18} fill="#fff" />
              <span>{pendingAction === 'stopping' ? 'Đang kết thúc…' : 'Kết thúc buổi'}</span>
            </>
          ) : (
            <>
              <Mic size={18} />
              <span>{pendingAction === 'starting' ? 'Đang bắt đầu…' : 'Bắt đầu thu'}</span>
            </>
          )}
        </button>

        <div className={styles.speechSettings}>
          <label htmlFor="speech-provider" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nhận giọng:</label>
          <select
            id="speech-provider"
            value={state.speechProvider}
            onChange={(event) => setSpeechProvider(event.target.value as 'google' | 'browser')}
            disabled={isRecording}
            style={{ padding: '6px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--text-primary)' }}
          >
            <option value="google">Google (API)</option>
            <option value="browser">Trình duyệt</option>
          </select>
        </div>

        <div className={styles.modelSettings} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <label htmlFor="translation-model" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Model dịch:</label>
          <select
            id="translation-model"
            value={state.translationModelKey}
            onChange={(e) => {
              const nextKey = e.target.value;
              setTranslationModel(nextKey);
              const nextModel = availableModels.find((model) => model.key === nextKey);
              if (state.translationThinkingLevel !== 'auto' && !nextModel?.thinkingLevels?.includes(state.translationThinkingLevel as 'minimal' | 'low' | 'medium' | 'high')) {
                setTranslationThinkingLevel('auto');
              }
            }}
            disabled={isRecording}
            style={{ padding: '6px 10px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--text-primary)' }}
          >
            {availableModels.map((m) => <option key={m.key} value={m.key}>{m.name}{!m.configured ? ' (Chưa có key)' : ''}</option>)}
            {availableModels.length === 0 && <option value="google:gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite · $0.25/$1.50 / 1M token</option>}
          </select>
          {(() => {
            const selected = availableModels.find((model) => model.key === state.translationModelKey);
            const levels = selected?.thinkingLevels ?? [];
            return levels.length > 0 ? (
              <>
                <label htmlFor="translation-thinking" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Suy luận:</label>
                <select id="translation-thinking" value={state.translationThinkingLevel} onChange={(e) => setTranslationThinkingLevel(e.target.value)} disabled={isRecording} style={{ padding: '6px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                  <option value="auto">Tự động</option>
                  {levels.map((level) => <option key={level} value={level}>{({ minimal: 'Tối thiểu', low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const)[level]}</option>)}
                </select>
              </>
            ) : null;
          })()}
        </div>

        {actionError && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{actionError}</span>}

        {/* Mode switcher */}
        <div
          className={styles.modeSwitch}
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => switchMode('lecture')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: '0.82rem',
              fontWeight: state.mode === 'lecture' ? 600 : 400,
              backgroundColor: state.mode === 'lecture' ? 'var(--bg-active)' : 'transparent',
              color: state.mode === 'lecture' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            <BookOpen size={14} />
            <span>Giảng bài</span>
          </button>
          <button
            onClick={() => switchMode('readingPractice')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: '0.82rem',
              fontWeight: state.mode === 'readingPractice' ? 600 : 400,
              backgroundColor: state.mode === 'readingPractice' ? 'var(--bg-active)' : 'transparent',
              color: state.mode === 'readingPractice' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            <Layers size={14} />
            <span>Luyện đọc</span>
          </button>
        </div>

        <label className={styles.pauseSetting} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
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
            style={{ width: 120, accentColor: 'var(--accent)' }}
          />
          <output style={{ minWidth: 32, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {((state.mode === 'lecture' ? state.pauseMs : state.readingPauseMs) / 1000).toFixed(1)}s
          </output>
        </label>
      </div>

      {/* Status & volume meter */}
      <div className={styles.toolbarStatus} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isRecording && (
          <div className={styles.volumeMeter} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Volume2 size={16} color="var(--accent)" />
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

        {isRecording && (
          <div className={styles.audioDiagnostics} aria-live="polite" aria-label="Chẩn đoán âm thanh và nhận giọng">
            <span>Nhận giọng: {state.speechProvider === 'google' ? 'Google (API)' : 'Trình duyệt'}</span>
            <span title={state.micDeviceLabel ? `Thiết bị micro: ${state.micDeviceLabel}` : undefined}>Mic: {{ live: 'đang bật', muted: 'đang tắt', ended: 'đã ngắt', suspended: 'tạm dừng', idle: 'chưa bật' }[state.micState]}</span>
            {state.speechProvider === 'google' && <span>Audio PCM nhận: {Math.floor(state.receivedAudioMs / 1000)}s</span>}
            <span>Kết quả nhận: {state.transcriptCount}</span>
            <span>Kết quả cuối: {state.lastTranscriptAt === null ? 'chưa có' : new Date(state.lastTranscriptAt).toLocaleTimeString()}</span>
            {state.translationLatencyMs !== null && <span>Dịch: {state.translationLatencyMs}ms</span>}
          </div>
        )}

        {isRecording && state.error && <span role="alert" className={styles.toolbarError}>{state.error}</span>}
        {isRecording && (state.micState === 'suspended' || state.micState === 'muted') && (
          <button type="button" onClick={() => void controller.resumeMicrophone()} className={styles.resumeMicButton}>
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
              {state.speakerStatus === 'working' ? 'Đang phân biệt người nói…' : state.speakerStatus === 'done' ? 'Phân biệt lại người nói' : 'Phân biệt người nói'}
            </button>
            {state.speakerMessage && <span>{state.speakerMessage}</span>}
          </div>
        )}

        <div
          style={{
            fontSize: '0.8rem',
            padding: '4px 8px',
            borderRadius: 4,
            backgroundColor:
              state.speechState === 'listening'
                ? 'rgba(34, 197, 94, 0.15)'
                : state.speechState === 'reconnecting'
                ? 'rgba(245, 158, 11, 0.15)'
                : 'transparent',
            color:
              state.speechState === 'listening'
                ? 'var(--success)'
                : state.speechState === 'reconnecting'
                ? 'var(--warning)'
                : 'var(--text-muted)',
            border:
              state.speechState === 'listening' || state.speechState === 'reconnecting'
                ? '1px solid currentColor'
                : 'none',
          }}
        >
          {state.speechState === 'listening'
            ? 'Đang nhận giọng'
            : state.speechState === 'reconnecting'
            ? 'Đang kết nối lại mic...'
            : isRecording
            ? 'Đang thu'
            : 'Sẵn sàng'}
        </div>
      </div>
    </div>
  );
}
