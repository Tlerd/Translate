'use client';

import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, Cpu } from 'lucide-react';
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
    return <div style={{ padding: 32 }}>Đang tải cài đặt...</div>;
  }

  const translationOrder = ['google:gemini-3.1-flash-lite', 'google:gemini-2.5-flash-lite', 'google:gemini-3.5-flash-lite', 'openai:gpt-4o-mini'];
  const translationModels = modelData?.models.filter((m) => m.allowedTasks.includes('translate') && m.enabled)
    .sort((a, b) => translationOrder.indexOf(a.key) - translationOrder.indexOf(b.key)) || [];
  const summaryModels = modelData?.models.filter((m) => m.allowedTasks.includes('summarize')) || [];
  const imageModels = modelData?.models.filter((m) => m.allowedTasks.includes('image')) || [];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Cấu Hình AI & Lớp Học
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          Cấu hình model dịch sát nút, model tóm tắt tổng quan và ngữ cảnh học tập.
        </p>
      </div>

      {savedMessage && (
        <div
          style={{
            padding: '10px 16px',
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
          <span>Đã lưu cài đặt thành công!</span>
        </div>
      )}

      {/* Warning Box on Model Separation */}
      <div
        style={{
          padding: '14px 16px',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
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
          • <strong>Phần B (Tóm tắt & Ảnh):</strong> Dùng model mạnh phân tích sâu, chỉ chạy khi bấm nút Tóm tắt. Hai model này bắt buộc khác nhau trên server.
        </div>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Model Translation */}
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
            Model dịch sát nút (Phần A - Ưu tiên chi phí thấp)
          </label>
          <select
            value={settings.translationModel}
            onChange={(e) => setSettings({ ...settings, translationModel: e.target.value })}
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
        </div>

        {/* Model Summary Status */}
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
            Model tóm tắt tổng quan (Phần B - Cấu hình cố định tại Server)
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
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Theo hợp đồng bảo mật mục 4, model tóm tắt được quy định qua biến <code>AI_SUMMARY_MODEL</code> trên server và không nhận thay đổi từ client.
          </p>
        </div>

        {/* Model Image */}
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

        {/* Glossary */}
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

        {/* Context */}
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

        <button
          type="submit"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 24px',
            backgroundColor: 'var(--bg-active)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '0.95rem',
            alignSelf: 'flex-start',
          }}
        >
          <Save size={18} />
          <span>Lưu cài đặt</span>
        </button>
      </form>
    </div>
  );
}
