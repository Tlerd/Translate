'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  MoreVertical,
  FileText,
  Sparkles,
  Headphones,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  Settings,
  Pencil,
  Loader2,
  Share2,
} from 'lucide-react';
import { TranscriptPane } from './transcript-pane';
import { TranscriptEditorDialog } from './transcript-editor-dialog';
import { playableAudio } from '@/storage/audio-sync';
import { computeCaptionSourceHash, saveSummary, updateCaptionSources, getExtensionFromMimeType } from '@/storage/recordings';
import { requestSummary } from '@/lib/api-client';
import type { RecordingItem, CaptionItem, SummaryItem } from '@/shared/recording';
import type { LocalAudioAsset } from '@/shared/audio';
import styles from './mobile-recording-detail.module.css';

interface MobileRecordingDetailProps {
  recording: RecordingItem;
  captions: CaptionItem[];
  summary?: SummaryItem;
  onSummaryUpdated?: (summary: SummaryItem) => void;
  costText?: string | null;
}

const WAVEFORM_HEIGHTS = [
  30, 45, 60, 25, 70, 85, 40, 65, 35, 90,
  55, 75, 40, 80, 60, 30, 50, 95, 70, 45,
  85, 60, 40, 75, 55, 30, 65, 80, 50, 70,
  45, 60, 35, 80, 55, 40,
];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function MobileRecordingDetail({
  recording,
  captions,
  summary: initialSummary,
  onSummaryUpdated,
}: MobileRecordingDetailProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'audio'>('transcript');
  const [headerVisible, setHeaderVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [summary, setSummary] = useState<SummaryItem | undefined>(initialSummary);
  const [summaryPreset, setSummaryPreset] = useState<'short' | 'default' | 'long' | 'easy'>('default');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  // Audio player states
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [asset, setAsset] = useState<LocalAudioAsset | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(recording.durationMs / 1000);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [audioLoading, setAudioLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);

  // Focus effect: scroll to hide top header & bottom navigation
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    const delta = currentScrollY - lastScrollY.current;

    if (currentScrollY <= 20) {
      setHeaderVisible(true);
    } else if (delta > 10) {
      setHeaderVisible(false);
      setMenuOpen(false);
    } else if (delta < -10) {
      setHeaderVisible(true);
    }
    lastScrollY.current = currentScrollY;
  };

  // Fetch audio asset for Tab 3
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    const abort = new AbortController();

    setAudioLoading(true);
    playableAudio(recording.id, abort.signal)
      .then((res) => {
        if (!active || !res.blob) return;
        url = URL.createObjectURL(res.blob);
        setAudioUrl(url);
        setAsset(res);
      })
      .catch((err) => {
        if (active) console.warn('Không thể nạp audio:', err);
      })
      .finally(() => {
        if (active) setAudioLoading(false);
      });

    return () => {
      active = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [recording.id]);

  // Audio event handlers
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

  const handleSeek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const skipRelative = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDur = duration > 0 ? duration : recording.durationMs / 1000;
    const nextTime = Math.min(maxDur, Math.max(0, audio.currentTime + seconds));
    handleSeek(nextTime);
  };

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Summary generation handler
  const handleGenerateSummary = async (preset: 'short' | 'default' | 'long' | 'easy' = summaryPreset) => {
    if (captions.length === 0) {
      alert('Chưa có nội dung chữ để tạo tóm tắt.');
      return;
    }
    setIsGeneratingSummary(true);
    try {
      const sourceHash = await computeCaptionSourceHash(captions);
      const res = await requestSummary({
        requestId: `sum_mob_${recording.id}_${Date.now()}`,
        recordingId: recording.id,
        sourceHash,
        targetLanguage: recording.targetLanguage || 'vi',
        modelKey: recording.config.summaryModelKey,
        translationModelKey: recording.config.translationModelKey,
        customPrompt:
          preset === 'short'
            ? 'Hãy tóm tắt thật cô đọng, ngắn gọn dưới 3 điểm chính.'
            : preset === 'long'
            ? 'Hãy tóm tắt thật chi tiết và đầy đủ các luận điểm.'
            : preset === 'easy'
            ? 'Hãy tóm tắt bằng ngôn ngữ đơn giản, dễ hiểu nhất cho học sinh.'
            : undefined,
        captions: captions.map((c) => ({
          id: c.id,
          startMs: c.startMs,
          endMs: c.endMs,
          source: c.source,
          revision: c.revision,
          isFinal: c.isFinal,
        })),
      });

      const summaryItem: SummaryItem = {
        id: `sum_${recording.id}`,
        recordingId: recording.id,
        sourceHash: res.sourceHash,
        preset: 'default',
        modelKey: res.modelKey,
        title: res.title,
        overview: res.overview,
        sections: res.sections,
        generatedAt: res.generatedAt,
      };

      await saveSummary(summaryItem);
      setSummary(summaryItem);
      if (onSummaryUpdated) onSummaryUpdated(summaryItem);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSaveSources = async (sources: Array<{ id: number; source: string }>) => {
    await updateCaptionSources(recording.id, sources);
  };

  const totalSec = duration > 0 ? duration : recording.durationMs / 1000;
  const progressRatio = totalSec > 0 ? currentTime / totalSec : 0;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className={styles.container}>
      {/* Hidden HTML5 Audio Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
          onLoadedMetadata={() => audioRef.current?.duration && setDuration(audioRef.current.duration)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
        />
      )}

      {/* =========================================================
          Top Header (Scroll to Hide)
          ========================================================= */}
      <header className={`${styles.topHeader} ${!headerVisible ? styles.topHeaderHidden : ''}`}>
        <Link href="/collections" className={styles.headerIconBtn} title="Quay lại Thư viện">
          <ArrowLeft size={18} />
        </Link>

        <div className={styles.headerCenter}>
          <h1 className={styles.headerTitle}>{recording.title}</h1>
          <span className={styles.headerSubtitle}>{formatDate(recording.createdAt)}</span>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={styles.headerIconBtn}
          title="Tùy chọn"
        >
          <MoreVertical size={18} />
        </button>

        {/* Options Dropdown */}
        {menuOpen && (
          <div className={styles.menuDropdown}>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                setEditorOpen(true);
              }}
            >
              <Pencil size={15} />
              <span>Sửa kịch bản</span>
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                setActiveTab('audio');
              }}
            >
              <Headphones size={15} />
              <span>Nghe ghi âm</span>
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(window.location.href);
                  alert('Đã sao chép liên kết buổi học!');
                }
              }}
            >
              <Share2 size={15} />
              <span>Chia sẻ liên kết</span>
            </button>
          </div>
        )}
      </header>

      {/* =========================================================
          Main Scrollable Content Area (Triggers Focus Mode)
          ========================================================= */}
      <main ref={scrollRef} className={styles.scrollContent} onScroll={handleScroll}>
        {/* Tab 1: [Bản gốc] (Clean Transcript, No Audio Player) */}
        {activeTab === 'transcript' && (
          <div style={{ height: '100%' }}>
            <TranscriptPane
              captions={captions}
              targetLanguage={recording.targetLanguage}
            />
          </div>
        )}

        {/* Tab 2: [Tóm tắt] (Summary with Hierarchy & Floating Toolbar) */}
        {activeTab === 'summary' && (
          <div className={styles.summaryContainer}>
            {summary ? (
              <>
                {/* 1. Key Takeaway / Khái quát nội dung */}
                {summary.overview && (
                  <div className={styles.takeawayCard}>
                    <div className={styles.takeawayTitle}>Khái quát cốt lõi</div>
                    <p className={styles.takeawayText}>{summary.overview}</p>
                  </div>
                )}

                {/* 2. Mục lục (Table of Contents) */}
                {summary.sections && summary.sections.length > 0 && (
                  <div className={styles.tocCard}>
                    <div className={styles.tocTitle}>Mục lục nội dung</div>
                    <ul className={styles.tocList}>
                      {summary.sections.map((sec, idx) => (
                        <li
                          key={idx}
                          className={styles.tocItem}
                          onClick={() => {
                            const el = document.getElementById(`summary-sec-${idx}`);
                            el?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          {idx + 1}. {sec.heading}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. Chi tiết từng mục */}
                {summary.sections?.map((sec, idx) => (
                  <div key={idx} id={`summary-sec-${idx}`} className={styles.sectionBlock}>
                    <h2 className={styles.sectionHeading}>
                      {idx + 1}. {sec.heading}
                    </h2>
                    <ul className={styles.bulletList}>
                      {sec.bullets.map((bullet, bIdx) => (
                        <li key={bIdx} className={styles.bulletItem}>
                          {bullet}
                          {sec.captionIds && sec.captionIds[bIdx] !== undefined && (
                            <span className={styles.citationTag}>[{sec.captionIds[bIdx]}]</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            ) : (
              <div className={styles.summaryEmptyState}>
                <Sparkles size={40} color="var(--color-primary, #6366f1)" />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Chưa có tóm tắt AI</h2>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>
                  Nhấn nút bên dưới để AI tự động phân tích và tạo dàn ý tóm tắt theo cấu trúc phân cấp.
                </p>
                <button
                  type="button"
                  onClick={() => handleGenerateSummary()}
                  disabled={isGeneratingSummary || captions.length === 0}
                  className={styles.generateBtn}
                >
                  {isGeneratingSummary ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Đang tóm tắt...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Tạo tóm tắt AI</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: [Âm thanh] (Hero Audio Player, Waveform, Controls, Speeds, Download) */}
        {activeTab === 'audio' && (
          <div className={styles.audioContainer}>
            {/* Audio Hero Card */}
            <div className={styles.audioHeroCard}>
              <div className={styles.audioHeader}>
                <div className={styles.audioIconBadge}>
                  <Headphones size={22} />
                </div>
                <div className={styles.audioMeta}>
                  <h2 className={styles.audioTitle}>{recording.title}</h2>
                  <div className={styles.audioSub}>
                    {formatDate(recording.createdAt)} • {formatTime(totalSec)}
                  </div>
                </div>
              </div>

              {/* Waveform Visualizer */}
              <div
                className={styles.waveformWrapper}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  handleSeek(pct * totalSec);
                }}
                title="Chạm để tua nhanh"
              >
                {WAVEFORM_HEIGHTS.map((h, i) => {
                  const barProgress = i / WAVEFORM_HEIGHTS.length;
                  const isPassed = barProgress <= progressRatio;
                  return (
                    <div
                      key={i}
                      className={`${styles.waveformBar} ${
                        isPassed ? styles.waveformBarPassed : styles.waveformBarRemaining
                      }`}
                      style={{
                        height: isPlaying ? `${Math.max(15, (h * (0.8 + Math.random() * 0.4)))}%` : `${h}%`,
                      }}
                    />
                  );
                })}
              </div>

              {/* Scrubber Row */}
              <div className={styles.scrubberRow}>
                <span className={styles.timeText}>{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalSec || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.timeText}>{formatTime(totalSec)}</span>
              </div>

              {/* Main Controls */}
              <div className={styles.mainControls}>
                <button
                  type="button"
                  onClick={() => skipRelative(-10)}
                  className={styles.skipBtn}
                  title="Lùi 10 giây"
                >
                  <RotateCcw size={18} />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={audioLoading}
                  className={styles.circlePlayBtn}
                  title={audioLoading ? 'Đang chuẩn bị âm thanh...' : isPlaying ? 'Tạm dừng' : 'Phát âm thanh'}
                >
                  {audioLoading ? (
                    <Loader2 size={24} className="animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={26} fill="#ffffff" />
                  ) : (
                    <Play size={26} fill="#ffffff" style={{ marginLeft: 3 }} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => skipRelative(10)}
                  className={styles.skipBtn}
                  title="Tua 10 giây"
                >
                  <RotateCw size={18} />
                </button>

                <button
                  type="button"
                  onClick={toggleMute}
                  className={styles.volumeBtn}
                  title={isMuted ? 'Bật tiếng' : 'Tắt tiếng'}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              </div>

              {/* Playback Speed Selector */}
              <div className={styles.speedRow}>
                {[1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => changePlaybackRate(rate)}
                    className={`${styles.speedPill} ${playbackRate === rate ? styles.speedPillActive : ''}`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {/* Download / Storage Card */}
            {audioUrl && (
              <div className={styles.downloadCard}>
                <div className={styles.downloadInfo}>
                  <span className={styles.downloadLabel}>Tệp ghi âm buổi học</span>
                  <span className={styles.downloadSub}>
                    {asset?.file ? `${(asset.file.sizeBytes / 1024 / 1024).toFixed(1)} MB • Đã sẵn sàng` : 'Lưu trữ cục bộ'}
                  </span>
                </div>
                <a
                  href={audioUrl}
                  download={`recording_${recording.id}.${asset?.file ? getExtensionFromMimeType(asset.file.mimeType) : 'webm'}`}
                  className={styles.downloadBtn}
                >
                  <Download size={15} />
                  <span>Tải về</span>
                </a>
              </div>
            )}
          </div>
        )}
      </main>

      {/* =========================================================
          Summary Toolbar Pill (Only shown on Tab 2, Scroll to Hide)
          ========================================================= */}
      {activeTab === 'summary' && (
        <div className={`${styles.summaryToolbar} ${!headerVisible ? styles.summaryToolbarHidden : ''}`}>
          <button
            type="button"
            onClick={() => {
              setSummaryPreset('short');
              handleGenerateSummary('short');
            }}
            className={`${styles.summaryPillBtn} ${summaryPreset === 'short' ? styles.summaryPillBtnActive : ''}`}
          >
            Ngắn
          </button>
          <button
            type="button"
            onClick={() => {
              setSummaryPreset('default');
              handleGenerateSummary('default');
            }}
            className={`${styles.summaryPillBtn} ${summaryPreset === 'default' ? styles.summaryPillBtnActive : ''}`}
          >
            Mặc định
          </button>
          <button
            type="button"
            onClick={() => {
              setSummaryPreset('long');
              handleGenerateSummary('long');
            }}
            className={`${styles.summaryPillBtn} ${summaryPreset === 'long' ? styles.summaryPillBtnActive : ''}`}
          >
            Dài
          </button>
          <div className={styles.summaryDivider} />
          <button
            type="button"
            onClick={() => {
              setSummaryPreset('easy');
              handleGenerateSummary('easy');
            }}
            className={`${styles.summaryPillBtn} ${summaryPreset === 'easy' ? styles.summaryPillBtnActive : ''}`}
          >
            Dễ
          </button>
          <div className={styles.summaryDivider} />
          <button
            type="button"
            onClick={() => {
              const custom = prompt('Nhập hướng dẫn tóm tắt đặc biệt cho AI:');
              if (custom) {
                // Trigger summary with custom instructions
                setIsGeneratingSummary(true);
                computeCaptionSourceHash(captions).then((sourceHash) => {
                  requestSummary({
                    requestId: `sum_mob_${recording.id}_${Date.now()}`,
                    recordingId: recording.id,
                    sourceHash,
                    targetLanguage: recording.targetLanguage || 'vi',
                    modelKey: recording.config.summaryModelKey,
                    translationModelKey: recording.config.translationModelKey,
                    customPrompt: custom,
                    captions: captions.map((c) => ({
                      id: c.id,
                      startMs: c.startMs,
                      endMs: c.endMs,
                      source: c.source,
                      revision: c.revision,
                      isFinal: c.isFinal,
                    })),
                  }).then((res) => {
                    const item: SummaryItem = {
                      id: `sum_${recording.id}`,
                      recordingId: recording.id,
                      sourceHash: res.sourceHash,
                      preset: 'default',
                      modelKey: res.modelKey,
                      title: res.title,
                      overview: res.overview,
                      sections: res.sections,
                      generatedAt: res.generatedAt,
                    };
                    saveSummary(item);
                    setSummary(item);
                    if (onSummaryUpdated) onSummaryUpdated(item);
                  }).finally(() => setIsGeneratingSummary(false));
                });
              }
            }}
            className={styles.summaryPillBtn}
            title="Cài đặt tóm tắt nâng cao"
          >
            <Settings size={14} />
          </button>
        </div>
      )}

      {/* =========================================================
          Bottom Navigation: [Bản gốc] | [Tóm tắt] | [Âm thanh] (Scroll to Hide)
          ========================================================= */}
      <nav className={`${styles.bottomNav} ${!headerVisible ? styles.bottomNavHidden : ''}`}>
        <button
          type="button"
          onClick={() => setActiveTab('transcript')}
          className={`${styles.tabBtn} ${activeTab === 'transcript' ? styles.tabBtnActive : ''}`}
        >
          <FileText size={19} />
          <span>Bản gốc</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`${styles.tabBtn} ${activeTab === 'summary' ? styles.tabBtnActive : ''}`}
        >
          <Sparkles size={19} />
          <span>Tóm tắt</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audio')}
          className={`${styles.tabBtn} ${activeTab === 'audio' ? styles.tabBtnActive : ''}`}
        >
          <Headphones size={19} />
          <span>Âm thanh</span>
        </button>
      </nav>

      {/* Transcript Editor Dialog */}
      {editorOpen && (
        <TranscriptEditorDialog
          captions={captions}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveSources}
        />
      )}
    </div>
  );
}
