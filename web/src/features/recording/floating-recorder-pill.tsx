'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecording } from './recording-context';
import styles from './floating-recorder-pill.module.css';
import { Pause, Play, Square, ArrowLeftRight } from 'lucide-react';

interface FloatingRecorderPillProps {
  onStop?: () => void;
}

function shortLangLabel(code: string): string {
  if (!code || code === 'none') return '--';
  if (code.startsWith('ja')) return 'JA';
  if (code.startsWith('vi')) return 'VI';
  if (code.startsWith('en')) return 'EN';
  if (code.startsWith('zh')) return 'ZH';
  if (code.startsWith('ko')) return 'KO';
  if (code.startsWith('fr')) return 'FR';
  if (code.startsWith('de')) return 'DE';
  if (code.startsWith('es')) return 'ES';
  return code.slice(0, 2).toUpperCase();
}

export function FloatingRecorderPill({ onStop }: FloatingRecorderPillProps) {
  const router = useRouter();
  const { state, stopRecording, pauseApi, resumeApi, swapLanguages } = useRecording();
  const [stopping, setStopping] = useState(false);
  const [swapping, setSwapping] = useState(false);

  if (state.state !== 'recording') return null;

  const formatTimer = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    const recordingId = state.recordingId;
    try {
      await stopRecording();
      onStop?.();
      if (recordingId) {
        router.push(`/recordings/${recordingId}`);
      } else {
        router.push('/collections');
      }
    } catch (err) {
      console.error('Lỗi dừng thu:', err);
      setStopping(false);
    }
  };

  const handleSwap = async () => {
    if (swapping) return;
    setSwapping(true);
    try {
      await swapLanguages();
    } catch (err) {
      console.error('Lỗi đổi hướng ngôn ngữ:', err);
    } finally {
      setSwapping(false);
    }
  };

  // Sound wave bar heights based on volume (0.0 to 1.0)
  const vol = Math.max(0.1, Math.min(1.0, state.audioVolume * 3));
  const h1 = Math.round(6 + vol * 10);
  const h2 = Math.round(10 + vol * 14);
  const h3 = Math.round(14 + vol * 16);
  const h4 = Math.round(8 + vol * 12);

  const srcLabel = shortLangLabel(state.sourceLanguage);
  const tgtLabel = shortLangLabel(state.targetLanguage);

  return (
    <div className={styles.pillContainer} role="region" aria-label="Thanh điều khiển thu âm">
      {/* Sound wave bars */}
      <div className={styles.waveIndicator} title="Âm lượng micro">
        <span className={styles.waveBar} style={{ height: `${h1}px` }} />
        <span className={styles.waveBar} style={{ height: `${h2}px` }} />
        <span className={styles.waveBar} style={{ height: `${h3}px` }} />
        <span className={styles.waveBar} style={{ height: `${h4}px` }} />
      </div>

      {/* Timer */}
      <span className={styles.timer}>{formatTimer(state.durationMs)}</span>

      {/* Divider */}
      <span className={styles.divider} />

      {/* Nút hoán đổi ngôn ngữ */}
      <button
        type="button"
        className={styles.swapBtn}
        onClick={handleSwap}
        disabled={swapping}
        title="Hoán đổi ngôn ngữ đầu vào và đầu ra"
        aria-label={`Hoán đổi ngôn ngữ ${srcLabel} và ${tgtLabel}`}
      >
        <span className={styles.langBadge}>{srcLabel}</span>
        <ArrowLeftRight size={13} />
        <span className={styles.langBadge}>{tgtLabel}</span>
      </button>

      {/* Divider */}
      <span className={styles.divider} />

      {/* Pause / Resume API button */}
      {state.apiState === 'paused' ? (
        <button
          type="button"
          onClick={() => void resumeApi()}
          className={styles.pauseBtn}
          title="Tiếp tục nhận giọng và dịch"
        >
          <Play size={13} fill="#fff" />
          <span>Tiếp tục</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void pauseApi()}
          className={styles.pauseBtn}
          title="Dừng gửi âm thanh tới API (vẫn tiếp tục ghi âm)"
        >
          <Pause size={13} fill="#fff" />
          <span>Dừng API</span>
        </button>
      )}

      {/* Divider */}
      <span className={styles.divider} />

      {/* Icon vuông đỏ dừng lại ở dưới */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className={styles.stopSquareBtn}
        title="Kết thúc buổi ghi và chốt audio"
      >
        <Square size={13} fill="#ef4444" color="#ef4444" />
        <span>{stopping ? 'Đang dừng…' : 'Dừng lại'}</span>
      </button>
    </div>
  );
}
