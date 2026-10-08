'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, FileAudio, Loader2, Mic } from 'lucide-react';
import { useRecording } from '@/features/recording/recording-context';
import { inputLanguages, OUTPUT_LANGUAGES } from '@/shared/languages';
import { saveSettings } from '@/storage/recordings';
import { SPEAKER_COUNTS, type SpeechProvider } from '@/shared/transcription';
import styles from './record-source.module.css';

const ENGINES: Array<{ id: SpeechProvider; name: string; hint: string }> = [
  { id: 'google-flash-live', name: 'Gemini 3 Flash Live', hint: 'Hiện chữ ngay khi đang nói, dịch theo từng câu.' },
  { id: 'google', name: 'Gemini 3.5 Translate Live', hint: 'Nhận giọng và dịch trực tiếp trong một luồng.' },
  { id: 'google-transcribe', name: 'Gemini 3.5 Transcribe', hint: 'Phiên âm theo đoạn sau mỗi lần ngắt câu, ổn định nhất.' },
  { id: 'soniox', name: 'Soniox', hint: 'Dịch trực tiếp 60+ ngôn ngữ, tự tách người nói.' },
];

export default function RecordSourcePage() {
  const router = useRouter();
  const { state, startRecording, setLanguages, swapLanguages } = useRecording();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Language names come from Intl.DisplayNames, which differs between the server and the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sources = mounted ? inputLanguages(state.speechProvider) : [];
  const targets = mounted ? OUTPUT_LANGUAGES : [];
  const canSwap = state.targetLanguage !== 'none';

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
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
      router.push('/recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStarting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topRow}>
          <Link href="/collections" className={styles.backBtn} title="Quay lại Thư viện">
            <ArrowLeft size={16} />
            <span>Quay lại</span>
          </Link>
          <Link href="/app?action=upload" className={styles.altLink}>
            <FileAudio size={15} />
            <span>Tải tệp âm thanh / video</span>
          </Link>
        </div>

        <header className={styles.hero}>
          <span className={styles.heroIcon} aria-hidden><Mic size={22} /></span>
          <h1 className={styles.pageTitle}>Ghi âm &amp; dịch trực tiếp</h1>
          <p className={styles.pageSub}>Chọn ngôn ngữ và bộ nhận giọng, rồi bấm Bắt đầu. Âm thanh luôn được lưu trên máy bạn.</p>
        </header>

        <section className={styles.card} aria-labelledby="lang-title">
          <h2 id="lang-title" className={styles.cardTitle}>Ngôn ngữ</h2>
          <div className={styles.langRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Người nói bằng</span>
              <select
                className={styles.select}
                value={state.sourceLanguage}
                onChange={(e) => setLanguages(e.target.value, state.targetLanguage)}
                disabled={isStarting}
              >
                {!mounted && <option value={state.sourceLanguage}>{state.sourceLanguage}</option>}
                {sources.map((opt) => <option key={opt.code} value={opt.code}>{opt.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className={styles.swapBtn}
              onClick={() => void swapLanguages()}
              disabled={isStarting || !canSwap}
              aria-label="Đổi chiều dịch"
              title="Đổi chiều dịch"
            >
              <ArrowLeftRight size={18} />
            </button>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dịch sang</span>
              <select
                className={styles.select}
                value={state.targetLanguage}
                onChange={(e) => setLanguages(state.sourceLanguage, e.target.value)}
                disabled={isStarting}
              >
                {!mounted && <option value={state.targetLanguage}>{state.targetLanguage}</option>}
                {targets.map((opt) => <option key={opt.code} value={opt.code}>{opt.name}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="engine-title">
          <h2 id="engine-title" className={styles.cardTitle}>Bộ nhận giọng</h2>
          <div className={styles.engineList} role="radiogroup" aria-labelledby="engine-title">
            {ENGINES.map((engine) => {
              const active = state.speechProvider === engine.id;
              return (
                <label key={engine.id} className={`${styles.engine} ${active ? styles.engineActive : ''}`}>
                  <input
                    type="radio"
                    name="speech-provider"
                    className={styles.engineInput}
                    checked={active}
                    disabled={isStarting}
                    onChange={() => void saveSettings({ speechProvider: engine.id })}
                  />
                  <span className={styles.engineName}>{engine.name}</span>
                  <span className={styles.engineHint}>{engine.hint}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="speaker-title">
          <h2 id="speaker-title" className={styles.cardTitle}>Người nói</h2>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Số người nói trong buổi này</span>
            <select
              className={styles.select}
              value={state.speakerCount}
              onChange={(e) => void saveSettings({ speakerCount: Number(e.target.value) as typeof state.speakerCount })}
              disabled={isStarting}
            >
              {SPEAKER_COUNTS.map((count) => <option key={count} value={count}>{count === 1 ? '1 người (không tách)' : `${count} người`}</option>)}
            </select>
          </label>
          <p className={styles.fieldHint}>
            Từ 2 người trở lên, Soniox và Gemini 3.5 Transcribe tự tách người nói. Gemini Live chưa có tách người nói trực tiếp; sau buổi bạn có thể bấm &quot;Phân biệt lại người nói&quot;.
          </p>
        </section>

        {error && <div role="alert" className={styles.error}>{error}</div>}
      </div>

      <div className={styles.startBar}>
        <button type="button" className={styles.startBtn} onClick={handleStart} disabled={isStarting}>
          {isStarting ? (
            <>
              <Loader2 size={18} className={styles.spin} />
              <span>Đang khởi động micro…</span>
            </>
          ) : (
            <>
              <Mic size={18} />
              <span>Bắt đầu ghi âm</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
