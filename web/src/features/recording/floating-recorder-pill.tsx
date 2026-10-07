'use client';

import React, { useState } from 'react';
import { useRecording } from './recording-context';
import { OUTPUT_LANGUAGES } from '@/shared/languages';
import styles from './floating-recorder-pill.module.css';
import { Pause, Play } from 'lucide-react';

interface FloatingRecorderPillProps {
  onStop?: () => void;
}

export function FloatingRecorderPill({ onStop }: FloatingRecorderPillProps) {
  const { state, stopRecording, pauseApi, resumeApi, setLanguages } = useRecording();
  const [stopping, setStopping] = useState(false);

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
    try {
      await stopRecording();
      onStop?.();
    } catch (err) {
      console.error('Lỗi dừng thu:', err);
      setStopping(false);
    }
  };

  // Sound wave bar heights based on volume (0.0 to 1.0)
  const vol = Math.max(0.1, Math.min(1.0, state.audioVolume * 3));
  const h1 = Math.round(6 + vol * 10);
  const h2 = Math.round(10 + vol * 14);
  const h3 = Math.round(14 + vol * 16);
  const h4 = Math.round(8 + vol * 12);

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

      {/* Target Language Dropdown (including "Không dịch") */}
      <select
        className={styles.langSelect}
        value={state.targetLanguage}
        onChange={(e) => setLanguages(state.sourceLanguage, e.target.value)}
        aria-label="Chọn ngôn ngữ đầu ra"
      >
        {OUTPUT_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>

      {/* Divider */}
      <span className={styles.divider} />

      {/* Pause / Resume API button */}
      {state.apiState === 'paused' ? (
        <button
          type="button"
          onClick={() => void resumeApi()}
          className={styles.pauseBtn}
          title="Tiếp tục gửi API"
        >
          <Play size={13} fill="#fff" />
          <span>Tiếp tục</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void pauseApi()}
          className={styles.pauseBtn}
          title="Tạm dừng gửi API"
        >
          <Pause size={13} fill="#fff" />
          <span>Tạm dừng</span>
        </button>
      )}

      {/* Divider */}
      <span className={styles.divider} />

      {/* Stop button (Red) */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className={styles.stopBtn}
        title="Dừng lại và kết thúc buổi thu"
      >
        {stopping ? 'Đang dừng…' : 'Dừng lại'}
      </button>
    </div>
  );
}
