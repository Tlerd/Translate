'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Download, X, Volume2, Clock, FileAudio, Check, AlertCircle, Loader2 } from 'lucide-react';
import { getAudioSegments, getAudioSegmentBlob, formatSegmentFileName } from '@/storage/recordings';
import type { AudioSegmentItem } from '@/shared/recording';
import styles from './audio-segments-dialog.module.css';

interface AudioSegmentsDialogProps {
  recordingId: string;
  isRecording?: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatOffsetTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `+${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function AudioSegmentsDialog({
  recordingId,
  isRecording = false,
  onClose,
}: AudioSegmentsDialogProps) {
  const [segments, setSegments] = useState<AudioSegmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [segmentAudioUrls, setSegmentAudioUrls] = useState<Record<number, string>>({});
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);

  const audioRefs = useRef<Map<number, HTMLAudioElement>>(new Map());
  const createdUrlsRef = useRef<Map<number, string>>(new Map());
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadSegments = useCallback(async () => {
    try {
      const list = await getAudioSegments(recordingId);
      setSegments(list);
    } catch (err) {
      console.error('Lỗi tải danh sách đoạn ghi âm:', err);
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  // Live polling when recording is active
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      loadSegments();
    }, 1500);
    return () => clearInterval(interval);
  }, [isRecording, loadSegments]);

  // Clean up all object URLs and audio on unmount
  useEffect(() => {
    const audios = audioRefs.current;
    const urls = createdUrlsRef.current;
    return () => {
      // Pause all audio
      audios.forEach((audio) => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
      });
      audios.clear();

      // Revoke all created URLs
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      urls.clear();
    };
  }, []);

  // Keyboard accessibility (ESC)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handlePlayToggle = async (seg: AudioSegmentItem) => {
    const index = seg.segmentIndex;

    // If already playing this segment, pause it
    if (playingIndex === index) {
      const activeAudio = audioRefs.current.get(index);
      if (activeAudio) {
        activeAudio.pause();
      }
      setPlayingIndex(null);
      return;
    }

    // Stop currently playing segment if any
    if (playingIndex !== null) {
      const prevAudio = audioRefs.current.get(playingIndex);
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    // Get or load audio URL
    let url = segmentAudioUrls[index];
    if (!url) {
      try {
        const audioData = await getAudioSegmentBlob(recordingId, index);
        if (!audioData || !audioData.blob) {
          alert('Chưa có dữ liệu âm thanh hoàn tất cho đoạn này.');
          return;
        }
        url = URL.createObjectURL(audioData.blob);
        createdUrlsRef.current.set(index, url);
        setSegmentAudioUrls((prev) => ({ ...prev, [index]: url }));
      } catch (err) {
        console.error('Lỗi tải đoạn âm thanh:', err);
        alert('Không thể tải đoạn âm thanh.');
        return;
      }
    }

    setPlayingIndex(index);
  };

  const handleDownload = async (seg: AudioSegmentItem) => {
    if (seg.status === 'recording') return;
    setDownloadingIndex(seg.segmentIndex);
    try {
      const audioData = await getAudioSegmentBlob(recordingId, seg.segmentIndex);
      if (!audioData || !audioData.blob) {
        alert('Không tìm thấy dữ liệu âm thanh để tải về.');
        return;
      }
      const filename = formatSegmentFileName(recordingId, seg.segmentIndex, audioData.mimeType || seg.mimeType);
      const tempUrl = URL.createObjectURL(audioData.blob);
      const a = document.createElement('a');
      a.href = tempUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
    } catch (err) {
      console.error('Lỗi khi tải về file âm thanh:', err);
      alert('Tải về thất bại.');
    } finally {
      setDownloadingIndex(null);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-segments-title"
    >
      <div className={styles.dialog} ref={dialogRef}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <Volume2 size={18} color="var(--accent)" />
            <h3 id="audio-segments-title" className={styles.title}>
              Danh sách đoạn ghi âm
            </h3>
            <span className={styles.segmentCountBadge}>
              {segments.length} đoạn
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.closeButton}
            aria-label="Đóng popup ghi âm"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {loading ? (
            <div className={styles.emptyState}>
              <Loader2 size={24} className="animate-spin" />
              <span>Đang kiểm tra các đoạn ghi âm…</span>
            </div>
          ) : segments.length === 0 ? (
            <div className={styles.emptyState}>
              <FileAudio size={36} />
              <span>Chưa có đoạn ghi âm nào trong buổi này.</span>
            </div>
          ) : (
            segments.map((seg) => {
              const isCurrentlyActive = isRecording && seg.status === 'recording';
              const isPlaying = playingIndex === seg.segmentIndex;
              const segAudioUrl = segmentAudioUrls[seg.segmentIndex];
              const isDownloading = downloadingIndex === seg.segmentIndex;

              return (
                <div
                  key={seg.segmentIndex}
                  className={`${styles.segmentCard} ${isCurrentlyActive ? styles.segmentCardActive : ''}`}
                >
                  {/* Card Header */}
                  <div className={styles.segmentHeader}>
                    <div className={styles.segmentTitleRow}>
                      <span className={styles.segmentIndex}>
                        Đoạn {String(seg.segmentIndex).padStart(2, '0')}
                      </span>
                      {seg.kind === 'translating' ? (
                        <span className={styles.kindBadgeTranslating}>
                          Đang dịch
                        </span>
                      ) : (
                        <span className={styles.kindBadgePaused}>
                          Nghỉ API
                        </span>
                      )}
                    </div>

                    <div>
                      {seg.status === 'recording' ? (
                        <span className={styles.statusBadgeRecording}>
                          <span className={styles.recordingDot} />
                          Đang ghi
                        </span>
                      ) : seg.status === 'completed' ? (
                        <span className={styles.statusBadgeCompleted}>
                          <Check size={12} /> Đã lưu
                        </span>
                      ) : (
                        <span className={styles.statusBadgeError}>
                          <AlertCircle size={12} /> Lỗi
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Details */}
                  <div className={styles.segmentDetails}>
                    <span className={styles.detailItem}>
                      <Clock size={13} />
                      Bắt đầu: {formatOffsetTime(seg.startMs)}
                    </span>
                    <span className={styles.detailItem}>
                      Thời lượng:{' '}
                      {seg.durationMs !== undefined && seg.durationMs > 0
                        ? formatDuration(seg.durationMs)
                        : seg.status === 'recording'
                        ? 'Đang thu…'
                        : '—'}
                    </span>
                    <span className={styles.detailItem}>
                      Định dạng: {(seg.mimeType || 'audio/webm').split(';')[0]}
                    </span>
                  </div>

                  {/* Embedded player if active */}
                  {isPlaying && segAudioUrl && (
                    <div className={styles.audioPlayerWrapper}>
                      <audio
                        ref={(el) => {
                          if (el) {
                            audioRefs.current.set(seg.segmentIndex, el);
                          } else {
                            audioRefs.current.delete(seg.segmentIndex);
                          }
                        }}
                        src={segAudioUrl}
                        controls
                        autoPlay
                        className={styles.nativeAudio}
                        onEnded={() => setPlayingIndex(null)}
                      />
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className={styles.segmentActions}>
                    <button
                      type="button"
                      onClick={() => handlePlayToggle(seg)}
                      disabled={seg.status === 'recording'}
                      className={`${styles.actionBtn} ${isPlaying ? styles.actionBtnPlay : ''}`}
                      title={
                        seg.status === 'recording'
                          ? 'Đoạn này đang thu, sẽ nghe được sau khi bấm Dừng hoặc Kết thúc'
                          : isPlaying
                          ? 'Tạm dừng nghe đoạn này'
                          : 'Nghe lại đoạn này'
                      }
                    >
                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                      <span>{isPlaying ? 'Tạm dừng' : 'Nghe lại'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownload(seg)}
                      disabled={seg.status === 'recording' || isDownloading}
                      className={styles.actionBtn}
                      title={
                        seg.status === 'recording'
                          ? 'Đang thu, chưa thể tải về'
                          : 'Tải file âm thanh đoạn này về máy'
                      }
                    >
                      {isDownloading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      <span>{isDownloading ? 'Đang chuẩn bị…' : 'Tải về'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span>Tất cả đoạn ghi âm được lưu an toàn trong trình duyệt thiết bị.</span>
          <button type="button" onClick={onClose} className={styles.closeFooterBtn}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
