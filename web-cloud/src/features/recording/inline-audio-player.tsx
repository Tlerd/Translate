'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { playableAudio } from '@/storage/audio-sync';
import styles from './inline-audio-player.module.css';

interface InlineAudioPlayerProps {
  recordingId: string;
  durationMs: number;
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function InlineAudioPlayer({ recordingId, durationMs }: InlineAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(durationMs / 1000);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    const abort = new AbortController();

    setLoading(true);
    playableAudio(recordingId, abort.signal)
      .then((asset) => {
        if (!active || !asset.blob) return;
        url = URL.createObjectURL(asset.blob);
        setAudioUrl(url);
      })
      .catch((err) => {
        if (active) console.warn('Không thể tải file audio buổi học:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordingId]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(console.warn);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.duration && Number.isFinite(audio.duration)) {
      setAudioDuration(audio.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const totalSec = audioDuration > 0 ? audioDuration : durationMs / 1000;

  return (
    <div className={styles.playerContainer} role="region" aria-label="Trình phát âm thanh bài học">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      )}

      {/* Play / Pause Button */}
      <button
        type="button"
        className={styles.playBtn}
        onClick={togglePlay}
        disabled={loading || !audioUrl}
        title={isPlaying ? 'Tạm dừng' : 'Phát bản ghi'}
        aria-label={isPlaying ? 'Tạm dừng âm thanh' : 'Phát âm thanh'}
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" />
        )}
      </button>

      {/* Time display: 00:00 / 00:24 */}
      <span className={styles.timeText}>
        {formatAudioTime(currentTime)} / {formatAudioTime(totalSec)}
      </span>

      {/* Seek Track */}
      <input
        type="range"
        min={0}
        max={totalSec > 0 ? totalSec : 1}
        step={0.1}
        value={currentTime}
        onChange={handleSeek}
        disabled={!audioUrl}
        className={styles.progressTrack}
        aria-label="Tiến trình phát âm thanh"
      />

      {/* Volume toggle */}
      <button
        type="button"
        className={styles.volumeBtn}
        onClick={toggleMute}
        title={isMuted ? 'Bật âm' : 'Tắt tiếng'}
      >
        {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
    </div>
  );
}
