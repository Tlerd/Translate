'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Activity, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { GeminiLiveRecognizer } from '@/features/recording/gemini-live-recognition';
import { pcmWav } from '@/features/recording/gemini-transcribe-recognition';
import { useRecording } from '@/features/recording/recording-context';
import {
  isLiveSpeechProvider,
  liveTranscriptionModel,
  TRANSCRIPTION_MODEL,
  speechProviderName,
} from '@/shared/transcription';

export function SpeechConnectionTest() {
  const { state } = useRecording();
  const [result, setResult] = useState<{
    state: 'idle' | 'checking' | 'done' | 'error';
    message: string;
  }>({
    state: 'idle',
    message: 'Kiểm tra quyền dùng model nhận giọng và kết nối đến Google AI.',
  });
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const live = useRef<GeminiLiveRecognizer | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
      void live.current?.stop(0);
    };
  }, []);

  const check = async () => {
    setResult({ state: 'checking', message: 'Đang kiểm tra Gemini nhận giọng…' });
    const startedAt = Date.now();
    const abort = new AbortController();
    request.current = abort;
    try {
      if (isLiveSpeechProvider(state.speechProvider)) {
        const recognizer = new GeminiLiveRecognizer(
          {
            onTranscript: () => undefined,
            onError: () => undefined,
            onStateChange: () => undefined,
          },
          state.sourceLanguage,
          state.transcriptionMode,
          liveTranscriptionModel(state.speechProvider)
        );
        live.current = recognizer;
        try {
          await recognizer.start(0);
          if (active.current) {
            setResult({
              state: 'done',
              message: `${speechProviderName(state.speechProvider)} kết nối thành công (${
                Date.now() - startedAt
              } ms).`,
            });
          }
        } finally {
          await recognizer.stop(0);
          if (live.current === recognizer) live.current = null;
        }
        return;
      }
      const form = new FormData();
      form.set('audio', pcmWav(new Float32Array(16000)), 'connection-test.wav');
      form.set('durationMs', '1000');
      form.set('transcriptionMode', state.transcriptionMode);
      form.set('speakerCount', String(state.speakerCount));
      form.set('model', TRANSCRIPTION_MODEL);
      const response = await fetch('/api/speech/transcribe', {
        method: 'POST',
        body: form,
        signal: abort.signal,
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.text !== 'string') {
        throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      }
      if (active.current) {
        setResult({
          state: 'done',
          message: `${speechProviderName(state.speechProvider)} kết nối thành công (${
            Date.now() - startedAt
          } ms). Key và quyền dùng model đã được Google chấp nhận.`,
        });
      }
    } catch (error) {
      if (active.current) {
        setResult({
          state: 'error',
          message:
            error instanceof Error ? error.message : 'Chưa kết nối được Gemini nhận giọng.',
        });
      }
    } finally {
      if (request.current === abort) request.current = null;
    }
  };

  return (
    <section
      id="speech-test"
      aria-label="Kiểm tra nhận giọng"
      style={{
        margin: '0 auto 36px',
        padding: '22px 24px',
        maxWidth: 860,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Mic size={18} color="var(--accent)" />
        </div>
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Kiểm Tra Kết Nối Nhận Diện Giọng Nói
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Xác thực khóa Google API và quyền gọi WebSocket / Transcribe API
          </span>
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', margin: 0, lineHeight: 1.5 }}>
        {isLiveSpeechProvider(state.speechProvider)
          ? 'Mở phiên Gemini Live bằng token tạm để kiểm tra quyền dùng model, không bật micro.'
          : `Gửi 1 giây audio im lặng tới ${speechProviderName(
              state.speechProvider
            )} để kiểm tra quyền dùng model đã lưu. Lượt thử có thể tính phí Google API.`}
      </p>

      <div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={result.state === 'checking'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            cursor: result.state === 'checking' ? 'not-allowed' : 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s ease',
          }}
        >
          {result.state === 'checking' ? (
            <>
              <Loader2 size={16} className="animate-spin" color="var(--accent)" />
              <span>Đang kiểm tra…</span>
            </>
          ) : (
            <>
              <Activity size={16} color="var(--accent)" />
              <span>Kiểm tra API nhận giọng</span>
            </>
          )}
        </button>
      </div>

      <div
        role="status"
        style={{
          padding: '12px 16px',
          backgroundColor:
            result.state === 'error'
              ? 'rgba(239, 68, 68, 0.1)'
              : result.state === 'done'
              ? 'rgba(34, 197, 94, 0.1)'
              : 'var(--bg-primary)',
          border: `1px solid ${
            result.state === 'error'
              ? 'var(--danger)'
              : result.state === 'done'
              ? 'var(--success)'
              : 'var(--border-color)'
          }`,
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.86rem',
          lineHeight: 1.5,
          color:
            result.state === 'error'
              ? 'var(--danger)'
              : result.state === 'done'
              ? 'var(--success)'
              : 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          overflowWrap: 'anywhere',
        }}
      >
        {result.state === 'done' && <CheckCircle2 size={18} style={{ flexShrink: 0 }} />}
        {result.state === 'error' && <AlertCircle size={18} style={{ flexShrink: 0 }} />}
        {result.state === 'checking' && (
          <Loader2 size={18} className="animate-spin" style={{ flexShrink: 0 }} />
        )}
        <span>{result.message}</span>
      </div>
    </section>
  );
}
