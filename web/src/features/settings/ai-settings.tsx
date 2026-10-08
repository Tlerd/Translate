'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Save,
  Cpu,
  Mic,
  Clock,
  Sparkles,
  Languages,
  CheckCircle2,
  ArrowLeftRight,
} from 'lucide-react';
import { fetchModels } from '@/lib/api-client';
import { loadSettings, saveSettings } from '@/storage/recordings';
import type { AppSettings } from '@/shared/recording';
import type { ModelsResponse } from '@/shared/ai-contracts';
import {
  SPEAKER_COUNTS,
  TRANSCRIPTION_MODEL,
  FLASH_LIVE_MODEL,
  isLiveSpeechProvider,
  type SpeakerCount,
  type TranscriptionMode,
} from '@/shared/transcription';
import { inputLanguages, OUTPUT_LANGUAGES } from '@/shared/languages';
import shared from './settings-shared.module.css';
import styles from './ai-settings.module.css';

interface RecentLanguagesProps {
  codes: string[];
  selected: string;
  direction: 'đầu vào' | 'đầu ra';
  getLabel: (code: string) => string;
  onPick: (code: string) => void;
}

/** Quick picks for the three most recent languages in one direction. */
function RecentLanguages({ codes, selected, direction, getLabel, onPick }: RecentLanguagesProps) {
  if (codes.length === 0) return null;
  return (
    <div className={shared.chipRow} role="group" aria-label={`Ngôn ngữ ${direction} gần đây`}>
      <span className={shared.chipRowLabel}>Gần đây:</span>
      {codes.map((code) => {
        const isSelected = selected === code;
        return (
          <button
            key={code}
            type="button"
            className={`${shared.chip} ${isSelected ? shared.chipActive : ''}`}
            aria-pressed={isSelected}
            title={`Chọn nhanh ngôn ngữ ${direction}: ${getLabel(code)}`}
            onClick={() => onPick(code)}
          >
            {getLabel(code)}
          </button>
        );
      })}
    </div>
  );
}

export function AiSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [modelData, setModelData] = useState<ModelsResponse | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    fetchModels().then(setModelData).catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    await saveSettings(settings);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  };

  if (!settings) {
    return <div className={styles.loading}>Đang tải cấu hình AI...</div>;
  }

  const summaryModels = modelData?.models.filter((m) => m.allowedTasks.includes('summarize')) || [];
  const imageModels = modelData?.models.filter((m) => m.allowedTasks.includes('image')) || [];

  const getLanguageLabel = (code: string) => {
    if (code === 'auto') return 'Tự động';
    if (code === 'none') return 'Không dịch';
    const inOpt = inputLanguages(settings.speechProvider).find((opt) => opt.code === code);
    if (inOpt) return inOpt.name;
    const outOpt = OUTPUT_LANGUAGES.find((opt) => opt.code === code);
    if (outOpt) return outOpt.name;
    return code;
  };

  const recentSourceLangs = (settings.recentSourceLanguages && settings.recentSourceLanguages.length > 0)
    ? settings.recentSourceLanguages.slice(0, 3)
    : ['en', 'vi', 'ja'];

  const recentTargetLangs = (settings.recentTargetLanguages && settings.recentTargetLanguages.length > 0)
    ? settings.recentTargetLanguages.slice(0, 3)
    : ['vi', 'en', 'ko'];

  const pickSourceLanguage = (code: string) => {
    const nextRecent = [code, ...(settings.recentSourceLanguages ?? []).filter((c) => c !== code)].slice(0, 3);
    setSettings({ ...settings, sourceLanguage: code, recentSourceLanguages: nextRecent });
  };

  const pickTargetLanguage = (code: string) => {
    const nextRecent = [code, ...(settings.recentTargetLanguages ?? []).filter((c) => c !== code)].slice(0, 3);
    setSettings({ ...settings, targetLanguage: code, recentTargetLanguages: nextRecent });
  };

  const handleSwapLanguages = () => {
    if (!settings) return;
    const { sourceLanguage, targetLanguage } = settings;
    if (sourceLanguage === 'auto' || targetLanguage === 'none') return;
    const nextRecentSrc = [targetLanguage, ...(settings.recentSourceLanguages ?? []).filter((c) => c !== targetLanguage)].slice(0, 3);
    const nextRecentTgt = [sourceLanguage, ...(settings.recentTargetLanguages ?? []).filter((c) => c !== sourceLanguage)].slice(0, 3);
    setSettings({
      ...settings,
      sourceLanguage: targetLanguage,
      targetLanguage: sourceLanguage,
      recentSourceLanguages: nextRecentSrc,
      recentTargetLanguages: nextRecentTgt,
    });
  };

  const swapDisabled = settings.sourceLanguage === 'auto' || settings.targetLanguage === 'none';
  const transcriptionLocked =
    settings.speechProvider === 'google-flash-live' || ['nemotron', 'soniox'].includes(settings.speechProvider);

  return (
    <div className={styles.root}>
      {savedMessage && (
        <div role="status" className={`${shared.notice} ${shared.noticeSuccess}`}>
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Đã lưu cài đặt thành công! Thiết lập mới sẽ áp dụng ngay cho các buổi học.</span>
        </div>
      )}

      <div className={`${shared.notice} ${shared.noticeInfo}`}>
        <Cpu size={18} aria-hidden="true" />
        <div className={styles.intro}>
          <strong className={styles.introTitle}>Kiến trúc trực tiếp từ giọng nói (Direct Speech Translation)</strong>
          <ul className={styles.introList}>
            <li>
              <strong>Phần A (Nhận diện &amp; Dịch trực tiếp):</strong> Dùng Gemini 3.5 Translate Live hoặc Soniox stt-rt-v5 dịch trực tiếp từ sóng âm micro ra ngôn ngữ đích đã chọn, không cần mô hình dịch chữ trung gian.
            </li>
            <li>
              <strong>Phần B (Tóm tắt &amp; Mindmap):</strong> Dùng Gemini phân tích sâu và trích xuất điểm chính sau khi kết thúc buổi ghi.
            </li>
          </ul>
        </div>
      </div>

      <form onSubmit={handleSave} className={styles.form}>
        {/* Ngôn ngữ chính (đầu vào & đầu ra) */}
        <section className={shared.card} aria-labelledby="ai-language-title">
          <div className={shared.cardHead}>
            <div className={shared.cardHeadMain}>
              <span className={shared.cardIcon}>
                <Languages size={18} aria-hidden="true" />
              </span>
              <div className={shared.cardText}>
                <h3 id="ai-language-title" className={shared.cardTitle}>Ngôn ngữ chính mặc định</h3>
                <p className={shared.cardDescription}>
                  Ngôn ngữ đầu vào và đầu ra mặc định cho các buổi học mới.
                </p>
              </div>
            </div>
          </div>

          <div className={shared.grid}>
            <div className={shared.field}>
              <label htmlFor="source-language" className={shared.label}>Ngôn ngữ đầu vào chính</label>
              <select
                id="source-language"
                className={shared.control}
                value={settings.sourceLanguage}
                onChange={(e) => pickSourceLanguage(e.target.value)}
              >
                {inputLanguages(settings.speechProvider).map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name} ({opt.code})
                  </option>
                ))}
              </select>
              <RecentLanguages
                codes={recentSourceLangs}
                selected={settings.sourceLanguage}
                direction="đầu vào"
                getLabel={getLanguageLabel}
                onPick={pickSourceLanguage}
              />
              <p className={shared.hint}>
                Chọn &ldquo;Tự nhận biết ngôn ngữ&rdquo; để hệ thống tự động xác định giọng nói.
              </p>
            </div>

            <div className={shared.field}>
              <label htmlFor="target-language" className={shared.label}>Ngôn ngữ đầu ra chính</label>
              <select
                id="target-language"
                className={shared.control}
                value={settings.targetLanguage}
                onChange={(e) => pickTargetLanguage(e.target.value)}
              >
                {OUTPUT_LANGUAGES.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name} ({opt.code})
                  </option>
                ))}
              </select>
              <RecentLanguages
                codes={recentTargetLangs}
                selected={settings.targetLanguage}
                direction="đầu ra"
                getLabel={getLanguageLabel}
                onPick={pickTargetLanguage}
              />
              <p className={shared.hint}>
                Chọn &ldquo;Không dịch&rdquo; nếu chỉ muốn chép lời thoại gốc mà không cần dịch.
              </p>
            </div>
          </div>

          <div className={styles.swapRow}>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnSecondary}`}
              onClick={handleSwapLanguages}
              disabled={swapDisabled}
              title={
                swapDisabled
                  ? 'Không thể hoán đổi khi ngôn ngữ là Tự động hoặc Không dịch'
                  : 'Hoán đổi ngôn ngữ đầu vào và đầu ra'
              }
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
              <span>Hoán đổi ngôn ngữ ({settings.sourceLanguage} ⇄ {settings.targetLanguage})</span>
            </button>
            {swapDisabled && (
              <p className={shared.hint}>
                Không thể hoán đổi khi ngôn ngữ là Tự động hoặc Không dịch.
              </p>
            )}
          </div>
        </section>

        {/* 1. Nhận giọng (speech provider) */}
        <section className={shared.card} aria-labelledby="ai-speech-title">
          <div className={shared.cardHead}>
            <div className={shared.cardHeadMain}>
              <span className={shared.cardIcon}>
                <Mic size={18} aria-hidden="true" />
              </span>
              <div className={shared.cardText}>
                <h3 id="ai-speech-title" className={shared.cardTitle}>1. Nhận diện giọng nói (Speech Recognition)</h3>
                <p className={shared.cardDescription}>Công nghệ chuyển lời nói thành văn bản trực tiếp.</p>
              </div>
            </div>
          </div>

          <div className={shared.cardBody}>
            <div className={shared.field}>
              <label htmlFor="speech-provider" className={shared.label}>Bộ nhận diện giọng nói</label>
              <select
                id="speech-provider"
                className={shared.control}
                required
                value={settings.speechProvider}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    speechProvider: e.target.value as AppSettings['speechProvider'],
                    ...(['nemotron', 'soniox'].includes(e.target.value) ? { transcriptionMode: 'verbatim' as const } : {}),
                  })
                }
              >
                <option value="google">Gemini 3.5 Translate Live · trực tiếp</option>
                <option value="soniox">Soniox · stt-rt-v5 · trực tiếp (dịch 60+ ngôn ngữ, tách người nói)</option>
                <option value="google-transcribe">Gemini 3.5 Transcribe · theo đoạn</option>
                <option value="google-flash-live">Gemini 3 Flash Live · trực tiếp</option>
                <option value="nemotron">Nemotron 3.5 ASR · máy chủ riêng · trực tiếp</option>
              </select>

              <div className={styles.providerNote}>
                <div className={styles.tagRow}>
                  <span className={shared.badge}>
                    {isLiveSpeechProvider(settings.speechProvider) ? 'Trực tiếp' : 'Theo đoạn'}
                  </span>
                </div>
                {settings.speechProvider === 'google-flash-live' && (
                  <p className={styles.providerText}>
                    <code className={shared.code}>{FLASH_LIVE_MODEL}</code> kết nối Live API, hiện chữ trực tiếp. Tự động gia hạn kết nối cho các buổi học dài.
                  </p>
                )}
                {settings.speechProvider === 'google' && (
                  <p className={styles.providerText}>
                    Gemini 3.5 Translate Live nhận diện giọng nói và dịch trực tiếp sang ngôn ngữ đích theo thời gian thực. Tự động gia hạn phiên kết nối cho các buổi học dài.
                  </p>
                )}
                {settings.speechProvider === 'soniox' && (
                  <p className={styles.providerText}>
                    Soniox stt-rt-v5 nhận diện và dịch hai chiều trực tiếp giữa Tiếng Nhật và Tiếng Việt từ sóng âm micro với độ trễ cực thấp. Key cấu hình trong SONIOX_API_KEY.
                  </p>
                )}
                {settings.speechProvider === 'nemotron' && (
                  <p className={styles.providerText}>
                    Nhận giọng trực tiếp trên máy chủ riêng, có tiếng Việt và tiếng Nhật. Chi phí phụ thuộc máy chủ; không có phí API theo giờ âm thanh. Lưu cài đặt rồi kiểm tra kết nối bên dưới.
                  </p>
                )}
                {!isLiveSpeechProvider(settings.speechProvider) && (
                  <p className={styles.providerText}>
                    <code className={shared.code}>{TRANSCRIPTION_MODEL}</code> nhận giọng theo từng đoạn. Chữ xuất hiện sau khoảng nghỉ hoặc mỗi 10 giây khi nói liên tục.
                  </p>
                )}
              </div>
            </div>

            <div className={styles.rows}>
              <div className={`${shared.field} ${shared.fieldInline}`}>
                <label htmlFor="transcription-mode" className={shared.label}>
                  Chế độ phiên âm (Transcription mode)
                </label>
                <select
                  id="transcription-mode"
                  className={shared.control}
                  disabled={transcriptionLocked}
                  required
                  aria-describedby="transcription-mode-help"
                  value={transcriptionLocked ? 'verbatim' : settings.transcriptionMode}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      transcriptionMode: e.target.value as TranscriptionMode,
                    })
                  }
                >
                  <option value="smart">smart - bỏ ừ/à, chuẩn văn viết</option>
                  <option value="verbatim">verbatim - nguyên văn từng từ</option>
                </select>
              </div>

              <div className={`${shared.field} ${shared.fieldInline}`}>
                <label htmlFor="speaker-count" className={shared.label}>Số người nói dự kiến</label>
                <select
                  id="speaker-count"
                  className={shared.control}
                  disabled={settings.speechProvider === 'google-flash-live' || settings.speechProvider === 'nemotron'}
                  value={settings.speakerCount}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      speakerCount: Number(e.target.value) as SpeakerCount,
                    })
                  }
                >
                  {SPEAKER_COUNTS.map((count) => (
                    <option key={count} value={count}>
                      {count} người nói
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p id="transcription-mode-help" className={shared.hint}>
              {settings.speechProvider === 'soniox'
                ? 'Soniox nhận giọng thường; chưa bật smart Google, dịch Soniox hoặc phân biệt giọng tự động. Gán người nói thủ công khi cần.'
                : settings.speechProvider === 'nemotron'
                ? 'Nemotron nhận dạng nguyên văn. Gán người nói thủ công khi cần; chưa bật phân biệt giọng tự động.'
                : 'Lưu ý: Chế độ Flash Live chỉ hỗ trợ verbatim và gán Speaker thủ công khi cần. Chi phí khoảng 0,005 USD/phút.'}
            </p>
          </div>
        </section>

        {/* 2. Khoảng nghỉ để chốt câu (pause duration) */}
        <section className={shared.card} aria-labelledby="ai-silence-title">
          <div className={shared.cardHead}>
            <div className={shared.cardHeadMain}>
              <span className={shared.cardIcon}>
                <Clock size={18} aria-hidden="true" />
              </span>
              <div className={shared.cardText}>
                <h3 id="ai-silence-title" className={shared.cardTitle}>2. Khoảng nghỉ để chốt câu (Silence Boundary)</h3>
                <p className={shared.cardDescription}>Thời gian im lặng cần thiết trước khi chốt câu hoàn chỉnh.</p>
              </div>
            </div>
          </div>

          <div className={shared.grid}>
            <div className={styles.sliderCard}>
              <div className={styles.sliderHead}>
                <label htmlFor="pause-lecture" className={shared.label}>Chế độ giảng bài</label>
                <span className={shared.valuePill}>{(settings.pauseMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                id="pause-lecture"
                type="range"
                className={shared.range}
                min={600}
                max={2000}
                step={100}
                value={settings.pauseMs}
                onChange={(e) =>
                  setSettings({ ...settings, pauseMs: Number(e.target.value) })
                }
                aria-label="Khoảng nghỉ để chốt câu, giây"
              />
              <p className={shared.hint}>Phù hợp với giọng nói giảng bài liên tục (0.6s - 2.0s).</p>
            </div>

            <div className={styles.sliderCard}>
              <div className={styles.sliderHead}>
                <label htmlFor="pause-reading" className={shared.label}>Chế độ hội thoại</label>
                <span className={shared.valuePill}>{(settings.readingPauseMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                id="pause-reading"
                type="range"
                className={shared.range}
                min={600}
                max={10000}
                step={100}
                value={settings.readingPauseMs}
                onChange={(e) =>
                  setSettings({ ...settings, readingPauseMs: Number(e.target.value) })
                }
                aria-label="Khoảng nghỉ để chốt câu khi hội thoại, giây"
              />
              <p className={shared.hint}>Thời gian chờ ngắt câu phù hợp cho giao tiếp và hội thoại (0.6s - 10.0s).</p>
            </div>
          </div>
        </section>

        {/* 3. Tóm tắt & sinh ảnh */}
        <section className={shared.card} aria-labelledby="ai-summary-title">
          <div className={shared.cardHead}>
            <div className={shared.cardHeadMain}>
              <span className={shared.cardIcon}>
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <div className={shared.cardText}>
                <h3 id="ai-summary-title" className={shared.cardTitle}>3. Tóm tắt &amp; minh họa (Phần B)</h3>
                <p className={shared.cardDescription}>Tạo bản ghi chép tổng kết bài học và hình ảnh minh họa.</p>
              </div>
            </div>
          </div>

          <div className={shared.grid}>
            <div className={shared.field}>
              <span id="summary-model-label" className={shared.label}>Model tóm tắt bài học</span>
              <div className={styles.readonly} role="group" aria-labelledby="summary-model-label">
                <span>{modelData?.defaults.summarize || 'google:gemini-3.8-flash'}</span>
                <span className={styles.readonlyNote}>(Cố định tại Server)</span>
              </div>
              {summaryModels.length > 0 && (
                <p className={shared.hint}>Hỗ trợ: {summaryModels.map((m) => m.name).join(', ')}</p>
              )}
            </div>

            <div className={shared.field}>
              <label htmlFor="image-model" className={shared.label}>Model sinh ảnh minh họa</label>
              <select
                id="image-model"
                className={shared.control}
                value={settings.imageModel}
                onChange={(e) => setSettings({ ...settings, imageModel: e.target.value })}
              >
                {imageModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name} {!m.configured ? '(Server chưa cấu hình API key)' : '✓ Đã sẵn sàng'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div className={shared.actionRow}>
          <button type="submit" className={`${shared.btn} ${shared.btnPrimary}`}>
            <Save size={18} aria-hidden="true" />
            <span>Lưu cài đặt</span>
          </button>
          <Link href="/library" className={`${shared.btn} ${shared.btnSecondary}`}>
            Hủy &amp; Quay lại
          </Link>
        </div>
      </form>
    </div>
  );
}
