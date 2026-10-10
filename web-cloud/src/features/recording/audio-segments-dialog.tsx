'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X, Volume2, RefreshCw } from 'lucide-react';
import { getExtensionFromMimeType, getRecording } from '@/storage/recordings';
import { playableAudio } from '@/storage/audio-sync';
import { getDb } from '@/storage/db';
import { audioChangedEvent, type LocalAudioAsset } from '@/shared/audio';
import styles from './audio-segments-dialog.module.css';

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function AudioSegmentsDialog({ recordingId, isRecording = false, onClose }: {
  recordingId: string; isRecording?: boolean; onClose: () => void;
}) {
  const [asset, setAsset] = useState<LocalAudioAsset | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [lessonMs, setLessonMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true; let objectUrl: string | null = null;
    const abort = new AbortController();
    setUrl(null); setError(null);
    void getRecording(recordingId).then(recording => { if (active) setLessonMs(recording?.durationMs ?? 0); });
    if (!isRecording) {
      setLoading(true);
      void playableAudio(recordingId, abort.signal).then(audio => {
        if (!active || !audio.blob) return;
        objectUrl = URL.createObjectURL(audio.blob);
        setAsset(audio); setUrl(objectUrl);
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không mở được audio.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    const update = () => { void getDb().audioAssets.get(recordingId).then(audio => { if (active && audio) { setAsset(audio); if (audio.status === 'deleted') { setUrl(null); setError('Audio đã được xóa trên thiết bị khác.'); } } }); };
    window.addEventListener(audioChangedEvent, update);
    return () => { active = false; abort.abort(); window.removeEventListener(audioChangedEvent, update); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [recordingId, isRecording, attempt]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const status = asset?.status === 'synced' ? 'Audio đã đồng bộ' : asset?.status === 'uploading' ? 'Audio đang tải lên cloud…'
    : asset?.status === 'error' ? `Audio chưa đồng bộ: ${asset.error ?? 'hãy thử lại'}` : 'Audio lưu trên máy · chờ đồng bộ';
  return <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="whole-audio-title"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],audio[controls]');
          if (elements?.length) {
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }
      }}>
      <header className={styles.header}><h2 id="whole-audio-title"><Volume2 size={20} /> Bản ghi toàn buổi</h2>
        <button type="button" onClick={onClose} aria-label="Đóng ghi âm"><X size={20} /></button></header>
      <div className={styles.content}>
        {isRecording ? <p role="status">Đang thu liên tục, kể cả lúc dừng API. Kết thúc buổi để nghe lại hoặc tải toàn bộ audio.</p>
          : loading ? <p role="status">Đang chuẩn bị audio để nghe…</p> : null}
        {error && <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} /> Thử lại</button></div>}
        {url && asset?.file && <>
          <p>Thời lượng audio: <strong>{duration(asset.file.durationMs)}</strong> · {(asset.file.sizeBytes / 1024 / 1024).toFixed(1)} MB</p>
          <audio controls preload="metadata" src={url} aria-label="Nghe toàn bộ buổi học" className={styles.player} />
          <a className={styles.download} href={url} download={`buoi_${recordingId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}.${getExtensionFromMimeType(asset.file.mimeType)}`}><Download size={16} /> Tải toàn buổi</a>
          {Math.abs(asset.file.durationMs - lessonMs) > 1000 && <p className={styles.note}>Thời gian buổi học: {duration(lessonMs)}. Trình phát dùng thời lượng thực của file; bản cũ có thể thiếu âm thanh so với thời gian buổi.</p>}
          <p className={styles.note} role="status">{status}</p>
        </>}
      </div>
      <footer className={styles.footer}><span>Bản gốc trên thiết bị được giữ sau khi đồng bộ.</span><button type="button" onClick={onClose}>Đóng</button></footer>
    </div>
  </div>;
}
