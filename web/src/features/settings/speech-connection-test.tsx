'use client';

import { useEffect, useRef, useState } from 'react';
import { GeminiLiveRecognizer } from '@/features/recording/gemini-live-recognition';

export function SpeechConnectionTest() {
  const [result, setResult] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; message: string }>({ state: 'idle', message: 'Kiểm tra quyền dùng model nhận giọng và kết nối đến Google.' });
  const recognizer = useRef<GeminiLiveRecognizer | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; void recognizer.current?.stop(0); };
  }, []);

  const check = async () => {
    setResult({ state: 'checking', message: 'Đang kiểm tra Gemini nhận giọng…' });
    const startedAt = Date.now();
    const connection = new GeminiLiveRecognizer({ onTranscript: () => undefined, onError: () => undefined, onStateChange: () => undefined });
    recognizer.current = connection;
    try {
      await connection.start(1, 'ja-JP');
      if (active.current) setResult({ state: 'done', message: `Gemini nhận giọng kết nối thành công (${Date.now() - startedAt} ms). Key và quyền dùng model đã được Google chấp nhận.` });
    } catch (error) {
      if (active.current) setResult({ state: 'error', message: error instanceof Error ? error.message : 'Chưa kết nối được Gemini nhận giọng.' });
    } finally {
      await connection.stop(0);
      if (recognizer.current === connection) recognizer.current = null;
    }
  };

  return <section aria-label="Kiểm tra nhận giọng" style={{ margin: '0 auto 32px', padding: '20px 24px', maxWidth: 800 }}>
    <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Kết nối nhận giọng</h2>
    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>Web dùng key Google đã cấu hình trên máy chủ. Nút này kiểm tra phiên kết nối trước khi bạn thu bài học.</p>
    <button type="button" onClick={() => void check()} disabled={result.state === 'checking'} style={{ padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
      {result.state === 'checking' ? 'Đang kiểm tra…' : 'Kiểm tra API nhận giọng'}
    </button>
    <p role="status" style={{ marginTop: 12, overflowWrap: 'anywhere', color: result.state === 'error' ? 'var(--danger)' : result.state === 'done' ? 'var(--success)' : 'var(--text-secondary)' }}>{result.message}</p>
  </section>;
}
