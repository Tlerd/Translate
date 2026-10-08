'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, Loader2, Mic } from 'lucide-react';
import { useRecording } from '@/features/recording/recording-context';
import { canCaptureDisplayAudio } from '@/features/recording/audio-input';
import { inputLanguages, OUTPUT_LANGUAGES } from '@/shared/languages';
import { saveSettings } from '@/storage/recordings';
import { SPEAKER_COUNTS, type SpeechProvider } from '@/shared/transcription';
import type { AudioSource } from '@/shared/recording';
import styles from './record-source.module.css';

const ENGINES: Array<{ id: SpeechProvider; name: string; hint: string }> = [
  { id: 'google-flash-live', name: 'Gemini 3 Flash Live', hint: 'Hiện chữ ngay khi đang nói, dịch theo từng câu.' },
  { id: 'google', name: 'Gemini 3.5 Translate Live', hint: 'Nhận giọng và dịch trực tiếp trong một luồng.' },
  { id: 'google-transcribe', name: 'Gemini 3.5 Transcribe', hint: 'Phiên âm theo đoạn sau mỗi lần ngắt câu, ổn định nhất.' },
  { id: 'soniox', name: 'Soniox', hint: 'Dịch trực tiếp 60+ ngôn ngữ, tự tách người nói.' },
];

const AUDIO_SOURCE_KEY = 'may-dich:audio-source';
const AUDIO_SOURCES: Array<{ id: AudioSource; name: string; hint: string }> = [
  { id: 'mic', name: 'Micro', hint: 'Thu giọng nói từ micro của thiết bị này.' },
  { id: 'display', name: 'Âm thanh tab / màn hình', hint: 'Chỉ nghe âm thanh của tab hoặc màn hình bạn chia sẻ, không dùng micro.' },
  { id: 'mixed', name: 'Micro + màn hình', hint: 'Thu cả micro và âm thanh tab hoặc màn hình, hợp khi vừa nói vừa nghe người khác.' },
];

function readStoredAudioSource(): AudioSource | null {
  try {
    const value = window.localStorage.getItem(AUDIO_SOURCE_KEY);
    return value === 'mic' || value === 'display' || value === 'mixed' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredAudioSource(source: AudioSource): void {
  try {
    window.localStorage.setItem(AUDIO_SOURCE_KEY, source);
  } catch {
    // Bộ nhớ bị chặn (chế độ riêng tư): lựa chọn vẫn có hiệu lực trong phiên này.
  }
}

interface ConsentDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

/** Asked on every start with display audio: the participants must agree to be recorded. */
function ConsentDialog({ onCancel, onConfirm }: ConsentDialogProps) {
  const [agreed, setAgreed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-text"
        className={styles.dialog}
      >
        <h2 id="consent-title" className={styles.dialogTitle}>Xác nhận trước khi ghi âm</h2>
        <p id="consent-text" className={styles.dialogText}>
          Hãy đảm bảo mọi người trong cuộc họp đã đồng ý được ghi âm và dịch. Máy Dịch lưu audio trên máy bạn và có thể đồng bộ lên cloud.
        </p>
        <label className={styles.consent}>
          <input
            type="checkbox"
            className={styles.consentInput}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>Mọi người trong cuộc họp đã đồng ý</span>
        </label>
        <div className={styles.dialogActions}>
          <button ref={cancelRef} type="button" className={styles.dialogBtn} onClick={onCancel}>
            Hủy
          </button>
          <button
            type="button"
            className={`${styles.dialogBtn} ${styles.dialogBtnPrimary}`}
            disabled={!agreed}
            onClick={onConfirm}
          >
            Tiếp tục và chọn tab
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecordSourcePage() {
  const router = useRouter();
  const { state, startRecording, setLanguages, swapLanguages } = useRecording();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>('mic');
  const [canDisplay, setCanDisplay] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // Language names come from Intl.DisplayNames, which differs between the server and the browser.
  // Browser-only checks (display capture support, saved audio source) also wait until mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const supported = canCaptureDisplayAudio();
    setCanDisplay(supported);
    const stored = readStoredAudioSource();
    if (stored && (stored === 'mic' || supported)) setAudioSource(stored);
  }, []);

  const closeConsent = useCallback(() => setConsentOpen(false), []);

  const sources = mounted ? inputLanguages(state.speechProvider) : [];
  const targets = mounted ? OUTPUT_LANGUAGES : [];
  const canSwap = state.targetLanguage !== 'none';

  const chooseAudioSource = (next: AudioSource) => {
    setAudioSource(next);
    writeStoredAudioSource(next);
  };

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
        audioSource,
      });
      router.push('/recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStarting(false);
    }
  };

  // Display capture must start inside the click, so nothing is awaited before handleStart.
  const handleStartClick = () => {
    if (isStarting) return;
    if (audioSource === 'mic') {
      void handleStart();
      return;
    }
    setConsentOpen(true);
  };

  const handleConsentConfirm = () => {
    setConsentOpen(false);
    void handleStart();
  };

  const displayUnsupported = mounted && !canDisplay;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topRow}>
          <Link href="/collections" className={styles.backBtn} title="Quay lại Thư viện">
            <ArrowLeft size={16} />
            <span>Quay lại</span>
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

        <section className={styles.card} aria-labelledby="source-title">
          <h2 id="source-title" className={styles.cardTitle}>Nguồn âm thanh</h2>
          <div className={styles.sourceList} role="radiogroup" aria-labelledby="source-title">
            {AUDIO_SOURCES.map((option) => {
              const active = audioSource === option.id;
              const unavailable = option.id !== 'mic' && !canDisplay;
              return (
                <label
                  key={option.id}
                  className={`${styles.sourceOption} ${active ? styles.sourceOptionActive : ''} ${unavailable ? styles.sourceOptionDisabled : ''}`}
                >
                  <input
                    type="radio"
                    name="audio-source"
                    value={option.id}
                    className={styles.sourceInput}
                    checked={active}
                    disabled={isStarting || unavailable}
                    aria-describedby={unavailable && displayUnsupported ? 'source-unsupported' : undefined}
                    onChange={() => chooseAudioSource(option.id)}
                  />
                  <span className={styles.sourceName}>{option.name}</span>
                  <span className={styles.sourceHint}>{option.hint}</span>
                </label>
              );
            })}
          </div>
          {displayUnsupported && (
            <p id="source-unsupported" className={styles.fieldHint}>
              Điện thoại và trình duyệt này chưa hỗ trợ ghi âm thanh màn hình. Hãy dùng Chrome hoặc Edge trên máy tính.
            </p>
          )}
          {audioSource !== 'mic' && (
            <details className={styles.help}>
              <summary className={styles.helpSummary}>Cách chia sẻ âm thanh Meet / Discord</summary>
              <ol className={styles.helpList}>
                <li>Google Meet hoặc Discord bản web: khi hộp chia sẻ hiện ra, chọn tab &quot;Thẻ Chrome&quot;, chọn đúng tab họp, rồi bật &quot;Chia sẻ âm thanh của thẻ&quot;.</li>
                <li>Windows, Discord bản máy tính: chọn &quot;Toàn bộ màn hình&quot; và bật &quot;Chia sẻ âm thanh hệ thống&quot;.</li>
                <li>macOS: chỉ chia sẻ được âm thanh của tab, nên hãy chọn đúng tab họp có tiếng.</li>
                <li>Nên đeo tai nghe để micro không thu lại tiếng loa.</li>
              </ol>
            </details>
          )}
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
        <button type="button" className={styles.startBtn} onClick={handleStartClick} disabled={isStarting}>
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

      {consentOpen && <ConsentDialog onCancel={closeConsent} onConfirm={handleConsentConfirm} />}
    </div>
  );
}
