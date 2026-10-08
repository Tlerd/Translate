'use client';

import React, { useEffect } from 'react';
import { Minimize2, Minus, Plus } from 'lucide-react';
import {
  READING_DISPLAYS,
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  type ReadingDisplay,
} from './reading-prefs';
import styles from './reading-mode.module.css';

interface ReadingModeProps {
  title: string;
  scale: number;
  display: ReadingDisplay;
  /** Without a translation the display choice is pointless, so the control is hidden. */
  hasTranslation: boolean;
  onScale: (direction: 1 | -1) => void;
  onDisplay: (display: ReadingDisplay) => void;
  onExit: () => void;
  children: React.ReactNode;
}

/**
 * Full-screen reading overlay for a saved recording: the app chrome, player and toolbars
 * disappear and the transcript fills the window. Esc (or the browser leaving full screen) exits.
 */
export function ReadingMode({ title, scale, display, hasTranslation, onScale, onDisplay, onExit, children }: ReadingModeProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    // Leaving browser full screen with its own Esc must leave reading mode too.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onExit();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // Best effort: browsers only allow this from a user gesture, and some refuse it entirely.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit]);

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label={`Đọc toàn màn hình: ${title}`}>
      <div className={styles.bar}>
        <button type="button" className={styles.exit} onClick={onExit} title="Thoát chế độ đọc (Esc)">
          <Minimize2 size={16} aria-hidden="true" />
          <span>Thoát</span>
        </button>
        <span className={styles.title} title={title}>{title}</span>
        <div className={styles.controls}>
          {hasTranslation && (
            <div className={styles.segmented} role="group" aria-label="Nội dung hiển thị">
              {READING_DISPLAYS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`${styles.segment} ${display === item.value ? styles.segmentActive : ''}`}
                  aria-pressed={display === item.value}
                  onClick={() => onDisplay(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <div className={styles.sizer} role="group" aria-label="Cỡ chữ">
            <button type="button" className={styles.iconButton} onClick={() => onScale(-1)} disabled={scale <= READING_SCALE_MIN} aria-label="Giảm cỡ chữ">
              <Minus size={16} aria-hidden="true" />
            </button>
            <span className={styles.scale} aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" className={styles.iconButton} onClick={() => onScale(1)} disabled={scale >= READING_SCALE_MAX} aria-label="Tăng cỡ chữ">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
