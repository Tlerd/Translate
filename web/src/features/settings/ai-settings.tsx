'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Save, ShieldCheck, Cpu, ArrowLeft, Mic, Clock, Sparkles } from 'lucide-react';
import { fetchModels } from '@/lib/api-client';
import { loadSettings, saveSettings } from '@/storage/recordings';
import type { AppSettings } from '@/shared/recording';
import type { ModelsResponse } from '@/shared/ai-contracts';

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
    return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Đang tải cài đặt...</div>;
  }

  const translationOrder = ['google:gemini-3.1-flash-lite', 'google:gemini-2.5-flash-lite', 'google:gemini-3.5-flash-lite', 'openai:gpt-4o-mini'];
  const translationModels = modelData?.models.filter((m) => m.allowedTasks.includes('translate') && m.enabled)
    .sort((a, b) => translationOrder.indexOf(a.key) - translationOrder.indexOf(b.key)) || [];
  const summaryModels = modelData?.models.filter((m) => m.allowedTasks.includes('summarize')) || [];
  const imageModels = modelData?.models.filter((m) => m.allowedTasks.includes('image')) || [];

  const selectedTranslationModel = translationModels.find((m) => m.key === settings.translationModel);
  const thinkingLevels = selectedTranslationModel?.thinkingLevels ?? [];

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Cấu Hình AI & Lớp Học
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            Tất cả cài đặt nhận giọng, model dịch, mức suy luận và thời gian chốt câu được quản lý tập trung tại đây.
          </p>
        </div>

        <Link
          href="/app"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            transition: 'all 0.15s',
          }}
        >
          <ArrowLeft size={16} />
          <span>Về phòng học</span>
        </Link>
      </div>

      {savedMessage && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid var(--success)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--success)',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ShieldCheck size={18} />
          <span>Đã lưu cài đặt thành công! Thiết lập mới sẽ áp dụng ngay cho các buổi học.</span>
        </div>
      )}

      {/* Warning Box on Model Separation */}
      <div
        style={{
          padding: '14px 16px',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          gap: 12,
        }}
      >
        <Cpu size={22} color="var(--accent)" style={{ minWidth: 22, marginTop: 2 }} />
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Kiến trúc hai model độc lập:</strong>
          <br />
          • <strong>Phần A (Dịch sát nút):</strong> Ưu tiên model rẻ, phản hồi nhanh theo từng câu nói live.
          <br />
          • <strong>Phần B (Tóm tắt & Ảnh):</strong> Dùng model mạnh phân tích sâu khi bấm Tóm tắt.
        </div>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 1. Nhận giọng (Speech Provider) */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label htmlFor="speech-provider" style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mic size={18} color="var(--accent)" />
            <span>Phương thức nhận giọng (Speech Provider)</span>
          </label>
          <select
            id="speech-provider"
            aria-label="Phương thức nhận giọng"
            value={settings.speechProvider}
            onChange={(e) => setSettings({ ...settings, speechProvider: e.target.value as 'google' | 'google-transcribe' | 'browser' })}
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.88rem',
            }}
          >
            <option value="google">Gemini 3.5 Transcribe Live · trực tiếp</option>
            <option value="google-transcribe">Gemini 3.5 Transcribe · theo đoạn</option>
            <option value="browser">Trình duyệt</option>
          </select>

          {settings.speechProvider !== 'browser' && (
            <details style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                {settings.speechProvider === 'google' ? 'Trực tiếp · 5 giờ nhận giọng ≈ 2,70 USD' : 'Theo đoạn · 5 giờ nhận giọng ≈ 1,50 USD'} — xem phí dịch
              </summary>
              <p style={{ margin: '8px 0', whiteSpace: 'normal' }}>
                {settings.speechProvider === 'google' ? 'Chữ trực tiếp.' : 'Chữ sau mỗi đoạn nghỉ, tối đa 15 giây + thời gian API.'}{' '}
                Ví dụ dịch bằng Gemini 3.1 Flash-Lite với tổng 100.000 token vào + 100.000 token ra: thêm ≈ 0,175 USD (5 giờ nhận giọng + dịch ≈ 2,88 USD Live / 1,68 USD theo đoạn). Chưa gồm tóm tắt, ảnh, phân người nói và các lượt dịch lại.{' '}
                <a href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  Bảng giá Google
                </a>
              </p>
            </details>
          )}
        </div>

        {/* 2. Model Translation & Thinking Level */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <label htmlFor="translation-model" style={{ fontSize: '0.92rem', fontWeight: 600 }}>
            Model dịch sát nút (Phần A - Ưu tiên chi phí thấp)
          </label>
          <select
            id="translation-model"
            aria-label="Model dịch:"
            value={settings.translationModel}
            onChange={(e) => {
              const nextKey = e.target.value;
              const nextModel = translationModels.find((m) => m.key === nextKey);
              let nextThinking = settings.translationThinkingLevel;
              if (nextThinking !== 'auto' && !nextModel?.thinkingLevels?.includes(nextThinking as 'minimal' | 'low' | 'medium' | 'high')) {
                nextThinking = 'auto';
              }
              setSettings({ ...settings, translationModel: nextKey, translationThinkingLevel: nextThinking });
            }}
            style={{
              padding: '10px 12px',
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

          {thinkingLevels.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <label htmlFor="translation-thinking" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Mức suy luận dịch (Thinking Level):
              </label>
              <select
                id="translation-thinking"
                aria-label="Suy luận:"
                value={settings.translationThinkingLevel}
                onChange={(e) => setSettings({ ...settings, translationThinkingLevel: e.target.value })}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="auto">Tự động</option>
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {({ minimal: 'Tối thiểu', low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const)[level]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 3. Khoảng nghỉ để chốt câu (Pause Duration) */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 600 }}>
            <Clock size={18} color="var(--accent)" />
            <span>Khoảng nghỉ để chốt câu</span>
          </div>

          {/* Giảng bài pause */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="pause-lecture" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Chế độ Giảng bài (0.6s - 2.0s):
              </label>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--accent)' }}>
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
              onChange={(e) => setSettings({ ...settings, pauseMs: Number(e.target.value) })}
              aria-label="Khoảng nghỉ để chốt câu, giây"
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>

          {/* Luyện đọc pause */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="pause-reading" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Chế độ Luyện đọc (0.6s - 10.0s):
              </label>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--accent)' }}>
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
              onChange={(e) => setSettings({ ...settings, readingPauseMs: Number(e.target.value) })}
              aria-label="Khoảng nghỉ để chốt câu khi luyện đọc, giây"
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>
        </div>

        {/* 4. Model Summary Status */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--accent)" />
            <span>Model tóm tắt tổng quan (Phần B - Cố định tại Server)</span>
          </label>
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent)',
              fontSize: '0.88rem',
              fontWeight: 500,
            }}
          >
            {modelData?.defaults.summarize || 'google:gemini-3.8-flash'} (Mặc định)
          </div>
          {summaryModels.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Model tóm tắt khả dụng trong danh mục:{' '}
              {summaryModels.map((m) => m.name).join(', ')}
            </div>
          )}
        </div>

        {/* 5. Model Image */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={{ fontSize: '0.92rem', fontWeight: 600 }}>
            Model sinh ảnh minh họa (Bước sau của Phần B)
          </label>
          <select
            value={settings.imageModel}
            onChange={(e) => setSettings({ ...settings, imageModel: e.target.value })}
            style={{
              padding: '10px 12px',
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

        {/* 6. Glossary */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={{ fontSize: '0.92rem', fontWeight: 600 }}>
            Thuật ngữ chuyên ngành (Glossary)
          </label>
          <textarea
            rows={4}
            value={settings.glossary}
            onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
            placeholder="Ví dụ:&#10;AI=Trí tuệ nhân tạo&#10;LLM=Mô hình ngôn ngữ lớn&#10;機械学習=Học máy"
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </div>

        {/* 7. Context */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={{ fontSize: '0.92rem', fontWeight: 600 }}>
            Ngữ cảnh buổi học / tình huống giao tiếp (Context)
          </label>
          <textarea
            rows={3}
            value={settings.context}
            onChange={(e) => setSettings({ ...settings, context: e.target.value })}
            placeholder="Ví dụ: Tiết học tiếng Nhật N2 chủ đề Kinh tế và Đàm phán thương mại."
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            type="submit"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 28px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              fontSize: '0.95rem',
              boxShadow: '0 2px 10px rgba(37, 99, 235, 0.35)',
              transition: 'all 0.2s',
            }}
          >
            <Save size={18} />
            <span>Lưu cài đặt</span>
          </button>

          <Link
            href="/app"
            style={{
              padding: '12px 20px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.9rem',
              fontWeight: 500,
            }}
          >
            Hủy & Quay lại
          </Link>
        </div>
      </form>
    </div>
  );
}
