'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, BookOpen, AlertCircle } from 'lucide-react';
import { fetchModels, requestSummary } from '@/lib/api-client';
import { computeCaptionSourceHash, saveSummary } from '@/storage/recordings';
import type { SummaryItem, CaptionItem } from '@/shared/recording';
import type { ModelInfo, ModelsResponse } from '@/shared/ai-contracts';

interface SummaryPanelProps {
  recordingId: string;
  captions: CaptionItem[];
  summary?: SummaryItem;
  summaryIsStale?: boolean;
  targetLanguage?: string;
  translationModelKey?: string;
  onSummaryGenerated: (summary: SummaryItem) => void;
  onSelectCaption?: (captionId: number) => void;
}

export function SummaryPanel({
  recordingId,
  captions,
  summary,
  summaryIsStale = false,
  targetLanguage = 'vi',
  translationModelKey = 'google:gemini-3.1-flash-lite',
  onSummaryGenerated,
  onSelectCaption,
}: SummaryPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelData, setModelData] = useState<ModelsResponse | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState('auto');
  const [selectedSummaryModelKey, setSelectedSummaryModelKey] = useState('');

  useEffect(() => {
    fetchModels().then((data) => {
      setModelData(data);
      setSelectedSummaryModelKey(data.defaults.summarize);
    }).catch((err) => console.warn('Lỗi lấy danh sách model:', err));
  }, []);

  const summaryModels = (modelData?.models ?? [])
    .filter((model) => model.allowedTasks.includes('summarize') && model.enabled)
    .sort((a, b) => {
      const order = ['google:gemini-3.1-flash-lite', 'google:gemini-2.5-flash-lite', 'google:gemini-3.8-flash'];
      return (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key));
    });
  const selectedSummaryModel: ModelInfo | undefined = summaryModels.find((model) => model.key === selectedSummaryModelKey);
  const summaryThinkingLevels = selectedSummaryModel?.thinkingLevels ?? [];

  const handleGenerateSummary = async () => {
    if (captions.length === 0) {
      alert('Chưa có nội dung chữ gốc để tóm tắt.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sourceHash = await computeCaptionSourceHash(captions);
      const requestId = `sum_${recordingId}_${Date.now()}`;

      const res = await requestSummary({
        requestId,
        recordingId,
        sourceHash,
        targetLanguage,
        thinkingLevel: thinkingLevel === 'auto' ? undefined : thinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
        modelKey: selectedSummaryModelKey || modelData?.defaults.summarize,
        translationModelKey,
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
        id: `sum_${recordingId}`,
        recordingId,
        sourceHash: res.sourceHash,
        preset: 'default',
        modelKey: res.modelKey,
        title: res.title,
        overview: res.overview,
        sections: res.sections,
        generatedAt: res.generatedAt,
      };

      await saveSummary(summaryItem);
      onSummaryGenerated(summaryItem);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '20px',
        overflowY: 'auto',
        gap: 16,
      }}
    >
      {/* Top action header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 12,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={20} color="var(--accent)" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Tóm Tắt Buổi Học</h3>
          <span
            style={{
              fontSize: '0.75rem',
              backgroundColor: 'var(--bg-hover)',
              padding: '2px 8px',
              borderRadius: 12,
              color: 'var(--text-secondary)',
            }}
          >
            Kiểu: Mặc định
          </span>
        </div>

        {summaryModels.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span>Model tóm tắt</span>
            <select aria-label="Model tóm tắt" value={selectedSummaryModelKey} onChange={(event) => { setSelectedSummaryModelKey(event.target.value); setThinkingLevel('auto'); }} disabled={loading} style={{ padding: '6px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
              {summaryModels.map((model) => <option key={model.key} value={model.key} disabled={model.key === translationModelKey}>{model.name}{model.key === translationModelKey ? ' (đang dùng để dịch)' : ''}</option>)}
            </select>
          </label>
        )}
        {summaryThinkingLevels.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span>Mức suy luận</span>
            <select aria-label="Mức suy luận tóm tắt" value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value)} disabled={loading} style={{ padding: '6px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
              <option value="auto">Tự động</option>
              {summaryThinkingLevels.map((level) => <option key={level} value={level}>{({ minimal: 'Tối thiểu', low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const)[level]}</option>)}
            </select>
          </label>
        )}
        <button
          onClick={handleGenerateSummary}
          disabled={loading || captions.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: loading ? 'var(--bg-hover)' : 'var(--bg-active)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            fontSize: '0.85rem',
            opacity: captions.length === 0 ? 0.5 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Đang tóm tắt...</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>{summaryIsStale ? 'Tạo lại' : summary ? 'Tóm tắt lại' : 'Tóm tắt'}</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)',
            fontSize: '0.88rem',
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Content */}
      {summary && summaryIsStale && (
        <div role="status" style={{ padding: '12px 14px', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-sm)', fontSize: '0.88rem' }}>
          Kịch bản đã được chỉnh sửa. Bản tóm tắt này chưa cập nhật; chọn <strong>Tạo lại</strong> để tóm tắt theo nội dung mới.
        </div>
      )}
      {summary ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              padding: '16px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {summary.title}
              </h2>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--accent)',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {summary.modelKey}
              </span>
            </div>

            <p style={{ marginTop: 10, fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {summary.overview}
            </p>
          </div>

          {/* Sections */}
          {summary.sections.map((sec, idx) => (
            <div
              key={idx}
              style={{
                padding: '14px 16px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent)' }}>
                {sec.heading}
              </h4>
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sec.bullets.map((b, bIdx) => (
                  <li key={bIdx} style={{ fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {b}
                  </li>
                ))}
              </ul>

              {/* Citations references */}
              {sec.captionIds && sec.captionIds.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>Dẫn nguồn câu:</span>
                  {sec.captionIds.map((cid) => (
                    <button
                      key={cid}
                      onClick={() => onSelectCaption && onSelectCaption(cid)}
                      style={{
                        padding: '1px 6px',
                        backgroundColor: 'var(--bg-hover)',
                        borderRadius: 4,
                        color: 'var(--accent)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                      title={`Xem lại câu #${cid} trong bản gốc`}
                    >
                      #{cid}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 16px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            gap: 10,
          }}
        >
          <Sparkles size={32} color="var(--text-muted)" />
          <p style={{ fontSize: '0.95rem' }}>Chưa có bản tóm tắt cho buổi này.</p>
          <p style={{ fontSize: '0.85rem' }}>
            Bấm nút <strong>Tóm tắt</strong> ở trên để tổng hợp nội dung bằng mô hình AI phân tích chuyên sâu.
          </p>
        </div>
      )}
    </div>
  );
}
