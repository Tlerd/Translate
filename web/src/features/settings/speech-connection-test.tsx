'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Activity, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { GeminiLiveRecognizer } from '@/features/recording/gemini-live-recognition';
import { NemotronRecognizer } from '@/features/recording/nemotron-recognition';
import { SonioxRecognizer } from '@/features/recording/soniox-recognition';
import { pcmWav } from '@/features/recording/gemini-transcribe-recognition';
import { useRecording } from '@/features/recording/recording-context';
import {
  isLiveSpeechProvider,
  liveTranscriptionModel,
  TRANSCRIPTION_MODEL,
  speechProviderName,
} from '@/shared/transcription';
import shared from './settings-shared.module.css';
import styles from './speech-connection-test.module.css';

export function SpeechConnectionTest() {
  const { state } = useRecording();
  const [result, setResult] = useState<{
    state: 'idle' | 'checking' | 'done' | 'error';
    message: string;
  }>({
    state: 'idle',
    message: 'Kiểm tra kết nối tới bộ nhận giọng đã chọn.',
  });
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const live = useRef<GeminiLiveRecognizer | NemotronRecognizer | SonioxRecognizer | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const testGeneration = generation;
    active.current = true;
    setResult({ state: 'idle', message: 'Kiểm tra kết nối tới bộ nhận giọng đã chọn.' });
    return () => {
      testGeneration.current++;
      active.current = false;
      request.current?.abort();
      void live.current?.stop(0);
    };
  }, [state.speechProvider]);

  const check = async () => {
    const checkingGeneration = ++generation.current;
    const isCurrent = () => active.current && generation.current === checkingGeneration;
    setResult({ state: 'checking', message: `Đang kiểm tra ${speechProviderName(state.speechProvider)}…` });
    const startedAt = Date.now();
    const abort = new AbortController();
    request.current = abort;
    try {
      if (isLiveSpeechProvider(state.speechProvider)) {
        const callbacks = {
            onTranscript: () => undefined,
            onError: () => undefined,
            onStateChange: () => undefined,
          };
        const recognizer = state.speechProvider === 'soniox'
          ? new SonioxRecognizer(callbacks, state.sourceLanguage)
          : state.speechProvider === 'nemotron'
          ? new NemotronRecognizer(callbacks, state.sourceLanguage, state.mode === 'readingPractice' ? state.readingPauseMs : state.pauseMs)
          : new GeminiLiveRecognizer(callbacks, state.sourceLanguage, state.transcriptionMode, liveTranscriptionModel(state.speechProvider));
        live.current = recognizer;
        try {
          if (recognizer instanceof SonioxRecognizer) await recognizer.testConnection();
          else await recognizer.start(0);
          if (isCurrent()) {
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
      if (isCurrent()) {
        setResult({
          state: 'done',
          message: `${speechProviderName(state.speechProvider)} kết nối thành công (${
            Date.now() - startedAt
          } ms). Key và quyền dùng model đã được Google chấp nhận.`,
        });
      }
    } catch (error) {
      if (isCurrent()) {
        setResult({
          state: 'error',
          message:
            error instanceof Error ? error.message : 'Chưa kết nối được bộ nhận giọng.',
        });
      }
    } finally {
      if (request.current === abort) request.current = null;
    }
  };

  const statusVariant =
    result.state === 'error'
      ? shared.noticeError
      : result.state === 'done'
      ? shared.noticeSuccess
      : '';

  return (
    <section id="speech-test" aria-label="Kiểm tra nhận giọng" className={shared.card}>
      <div className={shared.cardHead}>
        <div className={shared.cardHeadMain}>
          <span className={shared.cardIcon}>
            <Mic size={18} aria-hidden="true" />
          </span>
          <div className={shared.cardText}>
            <h3 className={shared.cardTitle}>Kiểm tra nhận giọng</h3>
            <p className={shared.cardDescription}>
              {state.speechProvider === 'soniox'
                ? 'Xác thực khóa tạm và xử lý audio Soniox'
                : state.speechProvider === 'nemotron'
                ? 'Kiểm tra máy chủ Nemotron đã cấu hình'
                : 'Xác thực khóa Google API và quyền gọi WebSocket / Transcribe API'}
            </p>
          </div>
        </div>
      </div>

      <p className={shared.hint}>
        {state.speechProvider === 'soniox'
          ? 'Gửi 1 giây PCM im lặng tổng hợp, không bật micro; chỉ thành công khi Soniox xác nhận finished. Lượt kiểm tra có thể tính phí Soniox.'
          : state.speechProvider === 'nemotron'
          ? 'Mở kết nối nhận giọng với máy chủ Nemotron để kiểm tra model sẵn sàng, không bật micro.'
          : isLiveSpeechProvider(state.speechProvider)
          ? 'Mở phiên Gemini Live bằng token tạm để kiểm tra quyền dùng model, không bật micro.'
          : `Gửi 1 giây audio im lặng tới ${speechProviderName(
              state.speechProvider
            )} để kiểm tra quyền dùng model đã lưu. Lượt thử có thể tính phí Google API.`}
      </p>

      <div className={shared.actionRow}>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnSecondary}`}
          onClick={() => void check()}
          disabled={result.state === 'checking'}
        >
          {result.state === 'checking' ? (
            <>
              <Loader2 size={16} aria-hidden="true" className={shared.spin} />
              <span>Đang kiểm tra…</span>
            </>
          ) : (
            <>
              <Activity size={16} aria-hidden="true" />
              <span>Kiểm tra API nhận giọng</span>
            </>
          )}
        </button>
      </div>

      <div role="status" className={`${shared.notice} ${statusVariant}`}>
        {result.state === 'done' && <CheckCircle2 size={18} aria-hidden="true" />}
        {result.state === 'error' && <AlertCircle size={18} aria-hidden="true" />}
        {result.state === 'checking' && <Loader2 size={18} aria-hidden="true" className={`${shared.spin} ${styles.checkingIcon}`} />}
        {result.state === 'idle' && <Info size={18} aria-hidden="true" />}
        <span className={styles.statusText}>{result.message}</span>
      </div>
    </section>
  );
}
