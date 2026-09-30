'use client';

import React, { useEffect, useState } from 'react';
import { Mic, Square, Volume2, BookOpen, Layers } from 'lucide-react';
import { useRecording } from './recording-context';
import { fetchModels } from '@/lib/api-client';
import type { ModelInfo } from '@/shared/ai-contracts';

interface RecorderToolbarProps {
  onStart?: () => void;
  onStop?: () => void;
}

export function RecorderToolbar({ onStart, onStop }: RecorderToolbarProps) {
  const { state, startRecording, stopRecording, switchMode, setTranslationModel, setPauseMs, setReadingPauseMs } = useRecording();

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [pendingAction, setPendingAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels()
      .then((data) => {
        const transModels = data.models.filter((m) => m.allowedTasks.includes('translate'));
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
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
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

        {actionError && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{actionError}</span>}

        {/* Mode switcher */}
        <div
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

        {/* Translation Model selection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Model dịch:</span>
          <select
            value={state.translationModelKey}
            onChange={(e) => setTranslationModel(e.target.value)}
            disabled={isRecording}
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
            }}
          >
            {availableModels.length > 0 ? (
              availableModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} {!m.configured ? '(Chưa có key)' : ''}
                </option>
              ))
            ) : (
              <>
                <option value="google:gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (Google)</option>
                <option value="openai:gpt-4o-mini">GPT-4o mini (OpenAI)</option>
              </>
            )}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Volume2 size={16} color="var(--accent)" />
            <div
              style={{
                width: 60,
                height: 6,
                backgroundColor: 'var(--bg-primary)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
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
