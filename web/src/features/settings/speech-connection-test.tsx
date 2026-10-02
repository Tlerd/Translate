'use client';

import { useEffect, useRef, useState } from 'react';
import { GeminiLiveRecognizer } from '@/features/recording/gemini-live-recognition';
import { pcmWav } from '@/features/recording/gemini-transcribe-recognition';
import { useRecording } from '@/features/recording/recording-context';
import { segmentedTranscriptionModel, speechProviderName } from '@/shared/transcription';

export function SpeechConnectionTest() {
  const { state } = useRecording();
  const [result, setResult] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; message: string }>({ state: 'idle', message: 'Kiểm tra quyền dùng model nhận giọng và kết nối đến Google.' });
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const live = useRef<GeminiLiveRecognizer | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current?.abort(); void live.current?.stop(0); };
  }, []);

  const check = async () => {
    setResult({ state: 'checking', message: 'Đang kiểm tra Gemini nhận giọng…' });
    const startedAt = Date.now();
    const abort = new AbortController();
    request.current = abort;
    try {
      if (state.speechProvider === 'google') {
        const recognizer = new GeminiLiveRecognizer({ onTranscript: () => undefined, onError: () => undefined, onStateChange: () => undefined }, state.sourceLanguage, state.transcriptionMode);
        live.current = recognizer;
        try {
          await recognizer.start(0);
          if (active.current) setResult({ state: 'done', message: `Gemini Live kết nối thành công (${Date.now() - startedAt} ms).` });
        } finally { await recognizer.stop(0); if (live.current === recognizer) live.current = null; }
        return;
      }
      const form = new FormData();
      form.set('audio', pcmWav(new Float32Array(16000)), 'connection-test.wav');
      form.set('durationMs', '1000');
      form.set('transcriptionMode', state.transcriptionMode);
      form.set('speakerCount', String(state.speakerCount));
      form.set('model', segmentedTranscriptionModel(state.speechProvider));
      const response = await fetch('/api/speech/transcribe', { method: 'POST', body: form, signal: abort.signal });
      const payload = await response.json();
      if (!response.ok || typeof payload.text !== 'string') throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      if (active.current) setResult({ state: 'done', message: `${speechProviderName(state.speechProvider)} kết nối thành công (${Date.now() - startedAt} ms). Key và quyền dùng model đã được Google chấp nhận.` });
    } catch (error) {
      if (active.current) setResult({ state: 'error', message: error instanceof Error ? error.message : 'Chưa kết nối được Gemini nhận giọng.' });
    } finally {
      if (request.current === abort) request.current = null;
    }
  };

  return <section aria-label="Kiểm tra nhận giọng" style={{ margin: '0 auto 32px', padding: '20px 24px', maxWidth: 800 }}>
    <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Kết nối nhận giọng</h2>
    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>{state.speechProvider === 'google' ? 'Mở phiên Gemini Live bằng token tạm để kiểm tra quyền dùng model, không bật micro.' : `Gửi 1 giây audio im lặng tới ${speechProviderName(state.speechProvider)} để kiểm tra quyền dùng model đã lưu. Lượt thử có thể tính phí Google API.`}</p>
    <button type="button" onClick={() => void check()} disabled={result.state === 'checking'} style={{ padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
      {result.state === 'checking' ? 'Đang kiểm tra…' : 'Kiểm tra API nhận giọng'}
    </button>
    <p role="status" style={{ marginTop: 12, overflowWrap: 'anywhere', color: result.state === 'error' ? 'var(--danger)' : result.state === 'done' ? 'var(--success)' : 'var(--text-secondary)' }}>{result.message}</p>
  </section>;
}
