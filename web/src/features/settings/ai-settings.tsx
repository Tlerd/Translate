'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Save,
  Cpu,
  ArrowLeft,
  Mic,
  Clock,
  Sparkles,
  Languages,
  BookOpen,
  CheckCircle2,
  ExternalLink,
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
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
        Đang tải cấu hình AI...
      </div>
    );
  }

  const translationOrder = [
    'google:gemini-3.1-flash-lite',
    'google:gemini-3.5-flash-lite',
    'openai:gpt-4o-mini',
  ];
  const translationModels =
    modelData?.models
      .filter((m) => m.allowedTasks.includes('translate') && m.enabled)
      .sort((a, b) => translationOrder.indexOf(a.key) - translationOrder.indexOf(b.key)) || [];
  const summaryModels = modelData?.models.filter((m) => m.allowedTasks.includes('summarize')) || [];
  const imageModels = modelData?.models.filter((m) => m.allowedTasks.includes('image')) || [];

  const selectedTranslationModel = translationModels.find(
    (m) => m.key === settings.translationModel
  );
  const thinkingLevels = selectedTranslationModel?.thinkingLevels ?? [];

  return (
    <div
      id="ai-config"
      style={{
        maxWidth: 860,
        margin: '0 auto',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.78rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--accent)',
              marginBottom: 4,
            }}
          >
            <Cpu size={14} />
            <span>Trung tâm cấu hình AI</span>
          </div>
          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Cấu Hình Model & Tham Số
          </h2>
          <p
            style={{
              fontSize: '0.88rem',
              color: 'var(--text-secondary)',
              marginTop: 4,
              marginBottom: 0,
              lineHeight: 1.5,
            }}
          >
            Thiết lập mô hình nhận diện giọng nói, model dịch sát nút theo thời gian thực và thời gian chốt câu.
          </p>
        </div>

        <Link
          href="/app"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 500,
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s ease',
          }}
        >
          <ArrowLeft size={16} />
          <span>Về phòng học</span>
        </Link>
      </div>

      {/* Save Success Alert */}
      {savedMessage && (
        <div
          role="status"
          style={{
            padding: '12px 18px',
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            border: '1px solid var(--success)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--success)',
            fontSize: '0.9rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 2px 8px rgba(34, 197, 94, 0.2)',
          }}
        >
          <CheckCircle2 size={18} />
          <span>Đã lưu cài đặt thành công! Thiết lập mới sẽ áp dụng ngay cho các buổi học.</span>
        </div>
      )}

      {/* Model Architecture Info Card */}
      <div
        style={{
          padding: '14px 18px',
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(37, 99, 235, 0.04) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <Cpu size={18} color="var(--accent)" />
        </div>
        <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Kiến trúc hai giai đoạn độc lập:
          </strong>
          <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>
              • <strong style={{ color: 'var(--accent)' }}>Phần A (Dịch sát nút):</strong> Dùng Gemini 3.1 Flash-Lite tối ưu độ trễ và chi phí theo từng câu nói live.
            </span>
            <span>
              • <strong style={{ color: 'var(--text-primary)' }}>Phần B (Tóm tắt & Ảnh):</strong> Dùng Gemini 3.8 Flash phân tích sâu và trích xuất điểm chính sau khi kết thúc buổi.
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* 1. Nhận giọng (Speech Provider) */}
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mic size={17} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                1. Nhận diện giọng nói (Speech Recognition)
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Công nghệ chuyển lời nói thành văn bản trực tiếp
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="speech-provider" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Bộ nhận diện giọng nói:
            </label>
            <select
              id="speech-provider"
              required
              value={settings.speechProvider}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  speechProvider: e.target.value as AppSettings['speechProvider'],
                  ...(['nemotron', 'soniox'].includes(e.target.value) ? { transcriptionMode: 'verbatim' as const } : {}),
                })
              }
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
              }}
            >
              <option value="google">Gemini 3.5 Transcribe Live · trực tiếp</option>
              <option value="google-transcribe">Gemini 3.5 Transcribe · theo đoạn</option>
              <option value="google-flash-live">Gemini 3 Flash Live · trực tiếp</option>
              <option value="soniox">Soniox · stt-rt-v5 · trực tiếp</option>
              <option value="nemotron">Nemotron 3.5 ASR · máy chủ riêng · trực tiếp</option>
            </select>
          </div>

          {settings.speechProvider === 'google-flash-live' && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              <code>{FLASH_LIVE_MODEL}</code> kết nối Live API, hiện chữ trực tiếp. Tự động gia hạn kết nối cho các buổi học dài.
            </p>
          )}
          {settings.speechProvider === 'google' && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Live hiện chữ trực tiếp, hỗ trợ verbatim/smart. Kết nối được tự động gia hạn trước giới hạn 10 phút của Google.
            </p>
          )}
          {settings.speechProvider === 'soniox' && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Nhận giọng Việt/Nhật trực tiếp; STT khoảng 0,12 USD/giờ phiên, phí thực tế theo token. Phí dịch chữ tính riêng theo model đang chọn. Key chỉ cấu hình phía server trong SONIOX_API_KEY. <a href="https://console.soniox.com" target="_blank" rel="noreferrer">Soniox Console</a>. Lưu rồi kiểm tra bên dưới.
            </p>
          )}
          {settings.speechProvider === 'nemotron' && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Nhận giọng trực tiếp trên máy chủ riêng, có tiếng Việt và tiếng Nhật. Chi phí phụ thuộc máy chủ; không có phí API theo giờ âm thanh. Lưu cài đặt rồi kiểm tra kết nối bên dưới.
            </p>
          )}
          {!isLiveSpeechProvider(settings.speechProvider) && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              <code>{TRANSCRIPTION_MODEL}</code> nhận giọng theo từng đoạn. Chữ xuất hiện sau khoảng nghỉ hoặc mỗi 15 giây khi nói liên tục.
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="transcription-mode" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Chế độ phiên âm (Transcription mode)
              </label>
              <select
                id="transcription-mode"
                disabled={settings.speechProvider === 'google-flash-live' || ['nemotron', 'soniox'].includes(settings.speechProvider)}
                required
                aria-describedby="transcription-mode-help"
                value={
                  settings.speechProvider === 'google-flash-live' || ['nemotron', 'soniox'].includes(settings.speechProvider)
                    ? 'verbatim'
                    : settings.transcriptionMode
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    transcriptionMode: e.target.value as TranscriptionMode,
                  })
                }
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  opacity: settings.speechProvider === 'google-flash-live' || ['nemotron', 'soniox'].includes(settings.speechProvider) ? 0.6 : 1,
                }}
              >
                <option value="smart">smart - bỏ ừ/à, chuẩn văn viết</option>
                <option value="verbatim">verbatim - nguyên văn từng từ</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="speaker-count" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Số người nói dự kiến:
              </label>
              <select
                id="speaker-count"
                disabled={settings.speechProvider === 'google-flash-live' || settings.speechProvider === 'nemotron'}
                value={settings.speakerCount}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    speakerCount: Number(e.target.value) as SpeakerCount,
                  })
                }
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  opacity: settings.speechProvider === 'google-flash-live' || settings.speechProvider === 'nemotron' ? 0.6 : 1,
                }}
              >
                {SPEAKER_COUNTS.map((count) => (
                  <option key={count} value={count}>
                    {count} người nói
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span id="transcription-mode-help" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {settings.speechProvider === 'soniox'
              ? 'Soniox nhận giọng thường; chưa bật smart Google, dịch Soniox hoặc phân biệt giọng tự động. Gán người nói thủ công khi cần.'
              : settings.speechProvider === 'nemotron'
              ? 'Nemotron nhận dạng nguyên văn. Gán người nói thủ công khi cần; chưa bật phân biệt giọng tự động.'
              : 'Lưu ý: Chế độ Flash Live chỉ hỗ trợ verbatim và gán Speaker thủ công khi cần. Chi phí khoảng 0,005 USD/phút.'}
          </span>
        </div>

        {/* 2. Model Dịch Sát Nút & Thinking Level */}
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Languages size={17} color="var(--accent)" />
              </div>
              <div>
                <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  2. Mô hình dịch sát nút (Live Translation)
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Dịch trực tiếp từng câu nói theo luồng Server-Sent Events
                </span>
              </div>
            </div>

            <a
              href="#translation-test"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.82rem',
                color: 'var(--accent)',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}
            >
              <span>Chạy thử model dịch này</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="translation-model" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Model dịch:
            </label>
            <select
              id="translation-model"
              aria-label="Model dịch:"
              value={settings.translationModel}
              onChange={(e) => {
                const nextKey = e.target.value;
                const nextModel = translationModels.find((m) => m.key === nextKey);
                let nextThinking = settings.translationThinkingLevel;
                if (
                  nextThinking !== 'auto' &&
                  !nextModel?.thinkingLevels?.includes(
                    nextThinking as 'minimal' | 'low' | 'medium' | 'high'
                  )
                ) {
                  nextThinking = 'auto';
                }
                setSettings({
                  ...settings,
                  translationModel: nextKey,
                  translationThinkingLevel: nextThinking,
                });
              }}
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
              }}
            >
              {translationModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} {!m.configured ? '(Server chưa cấu hình API key)' : '✓ Đã sẵn sàng'}
                </option>
              ))}
            </select>
          </div>

          {thinkingLevels.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label
                htmlFor="translation-thinking"
                style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 600 }}
              >
                Mức suy luận dịch (Thinking Level):
              </label>
              <select
                id="translation-thinking"
                aria-label="Suy luận:"
                value={settings.translationThinkingLevel}
                onChange={(e) =>
                  setSettings({ ...settings, translationThinkingLevel: e.target.value })
                }
                style={{
                  padding: '9px 14px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.86rem',
                }}
              >
                <option value="auto">Tự động (Theo mặc định model)</option>
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {
                      (
                        {
                          minimal: 'Tối thiểu (Cực nhanh, tiết kiệm nhất)',
                          low: 'Thấp (Khuyên dùng cho dịch)',
                          medium: 'Vừa',
                          high: 'Cao (Lập luận sâu)',
                        } as const
                      )[level]
                    }
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor="translation-history-turns"
              style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              Số câu ngữ cảnh trước đó (Translation History Turns):
            </label>
            <select
              id="translation-history-turns"
              aria-label="Số câu ngữ cảnh trước đó:"
              value={settings.translationHistoryTurns ?? 6}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  translationHistoryTurns: Number(e.target.value),
                })
              }
              style={{
                padding: '9px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.86rem',
              }}
            >
              <option value={0}>0 câu · Từng câu độc lập (Tiết kiệm token & chi phí nhất)</option>
              <option value={1}>1 câu · Ngữ cảnh ngắn</option>
              <option value={2}>2 câu · Ngữ cảnh vừa</option>
              <option value={3}>3 câu</option>
              <option value={4}>4 câu</option>
              <option value={5}>5 câu</option>
              <option value={6}>6 câu · Tối đa (Mặc định)</option>
            </select>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Ngữ cảnh giúp AI dịch chuẩn đại từ nhân xưng và mạch câu chuyện, nhưng mỗi câu làm tăng số lượng token đầu vào (input tokens). Chọn 0 để tối ưu chi phí tối đa.
            </span>
          </div>
        </div>

        {/* 3. Khoảng Nghỉ Để Chốt Câu (Pause Duration) */}
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={17} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                3. Khoảng nghỉ để chốt câu (Silence Boundary)
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Thời gian im lặng cần thiết trước khi gửi câu đi dịch
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            {/* Chế độ Giảng bài */}
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label
                  htmlFor="pause-lecture"
                  style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  Chế độ Giảng bài:
                </label>
                <span
                  style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: 'var(--accent)',
                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                    padding: '2px 8px',
                    borderRadius: 4,
                  }}
                >
                  {(settings.pauseMs / 1000).toFixed(1)}s
                </span>
              </div>
              <input
                id="pause-lecture"
                type="range"
                min={600}
                max={2000}
                step={100}
                value={settings.pauseMs}
                onChange={(e) =>
                  setSettings({ ...settings, pauseMs: Number(e.target.value) })
                }
                aria-label="Khoảng nghỉ để chốt câu, giây"
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Phù hợp với giọng nói giảng bài liên tục (0.6s - 2.0s)
              </span>
            </div>

            {/* Chế độ Luyện đọc */}
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label
                  htmlFor="pause-reading"
                  style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  Chế độ Luyện đọc:
                </label>
                <span
                  style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: 'var(--accent)',
                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                    padding: '2px 8px',
                    borderRadius: 4,
                  }}
                >
                  {(settings.readingPauseMs / 1000).toFixed(1)}s
                </span>
              </div>
              <input
                id="pause-reading"
                type="range"
                min={600}
                max={10000}
                step={100}
                value={settings.readingPauseMs}
                onChange={(e) =>
                  setSettings({ ...settings, readingPauseMs: Number(e.target.value) })
                }
                aria-label="Khoảng nghỉ để chốt câu khi luyện đọc, giây"
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Thời gian chờ ngắt câu dài hơn cho người đang đọc chậm (0.6s - 10.0s)
              </span>
            </div>
          </div>
        </div>

        {/* 4. Model Tóm Tắt & Sinh Ảnh */}
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={17} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                4. Tóm tắt & Minh họa (Phần B)
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Tạo bản ghi chép tổng kết bài học và hình ảnh minh họa
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {/* Summary Model Display */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Model tóm tắt bài học:
              </label>
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent)',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{modelData?.defaults.summarize || 'google:gemini-3.8-flash'}</span>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  (Cố định tại Server)
                </span>
              </div>
              {summaryModels.length > 0 && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Hỗ trợ: {summaryModels.map((m) => m.name).join(', ')}
                </span>
              )}
            </div>

            {/* Image Model Select */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Model sinh ảnh minh họa:
              </label>
              <select
                value={settings.imageModel}
                onChange={(e) => setSettings({ ...settings, imageModel: e.target.value })}
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                }}
              >
                {imageModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name} {!m.configured ? '(Server chưa cấu hình API key)' : '✓ Đã sẵn sàng'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 5. Glossary & Context */}
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BookOpen size={17} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                5. Thuật ngữ & Ngữ cảnh riêng (Context & Glossary)
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Tăng độ chính xác khi dịch các từ ngữ chuyên ngành
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="settings-glossary" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Thuật ngữ chuyên ngành (Glossary):
            </label>
            <textarea
              id="settings-glossary"
              rows={3}
              value={settings.glossary}
              onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
              placeholder="Ví dụ:&#10;AI=Trí tuệ nhân tạo&#10;LLM=Mô hình ngôn ngữ lớn&#10;機械学習=Học máy"
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.86rem',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="settings-context" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Ngữ cảnh bài học / cuộc hội thoại (Context):
            </label>
            <textarea
              id="settings-context"
              rows={2}
              value={settings.context}
              onChange={(e) => setSettings({ ...settings, context: e.target.value })}
              placeholder="Ví dụ: Tiết học tiếng Nhật N2 chủ đề Kinh tế và Đàm phán thương mại."
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.86rem',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </div>
        </div>

        {/* Action Button Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingTop: 8,
          }}
        >
          <button
            type="submit"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 32px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: '0.95rem',
              boxShadow: '0 2px 10px rgba(37, 99, 235, 0.4)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Save size={18} />
            <span>Lưu cài đặt</span>
          </button>

          <Link
            href="/app"
            style={{
              padding: '12px 22px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.9rem',
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Hủy & Quay lại
          </Link>
        </div>
      </form>
    </div>
  );
}
