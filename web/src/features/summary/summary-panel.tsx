'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, BookOpen, AlertCircle } from 'lucide-react';
import { fetchModels, requestSummary } from '@/lib/api-client';
import { computeCaptionSourceHash, saveSummary } from '@/storage/recordings';
import type { SummaryItem, CaptionItem } from '@/shared/recording';
import type { ModelInfo, ModelsResponse } from '@/shared/ai-contracts';
import styles from './summary-panel.module.css';

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
  const [customPrompt, setCustomPrompt] = useState('');
  const [isAuthoring, setIsAuthoring] = useState(false);
  const [authorTitle, setAuthorTitle] = useState('');
  const [authorOverview, setAuthorOverview] = useState('');
  const [authorBulletsText, setAuthorBulletsText] = useState('');

  useEffect(() => {
    fetchModels()
      .then((data) => {
        setModelData(data);
        setSelectedSummaryModelKey(data.defaults.summarize);
      })
      .catch((err) => console.warn('Lỗi lấy danh sách model:', err));
  }, []);

  const summaryModels = (modelData?.models ?? [])
    .filter((model) => model.allowedTasks.includes('summarize') && model.enabled)
    .sort((a, b) => {
      const order = ['google:gemini-3.1-flash-lite', 'google:gemini-3.8-flash'];
      return (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key));
    });
  const selectedSummaryModel: ModelInfo | undefined = summaryModels.find((model) => model.key === selectedSummaryModelKey);
  const summaryThinkingLevels = selectedSummaryModel?.thinkingLevels ?? [];

  const handleStartAuthoring = () => {
    setAuthorTitle(summary?.title || 'Tóm tắt buổi học');
    setAuthorOverview(summary?.overview || '');
    const bullets = (summary?.sections ?? []).flatMap(s => s.bullets).join('\n');
    setAuthorBulletsText(bullets || '');
    setIsAuthoring(true);
  };

  const handleSaveAuthoring = async () => {
    if (!authorTitle.trim()) {
      alert('Vui lòng nhập tiêu đề tóm tắt.');
      return;
    }
    try {
      const sourceHash = await computeCaptionSourceHash(captions);
      const bullets = authorBulletsText
        .split('\n')
        .map(b => b.trim())
        .filter(Boolean);

      const manualSummary: SummaryItem = {
        id: `sum_${recordingId}`,
        recordingId,
        sourceHash,
        preset: 'default',
        modelKey: 'Tự biên soạn',
        title: authorTitle.trim(),
        overview: authorOverview.trim(),
        sections: [
          {
            heading: 'Nội dung cốt lõi',
            bullets: bullets.length ? bullets : ['Đã lưu tóm tắt theo nội dung tự nhập.'],
            captionIds: [],
          },
        ],
        generatedAt: new Date().toISOString(),
      };
      await saveSummary(manualSummary);
      onSummaryGenerated(manualSummary);
      setIsAuthoring(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

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
        thinkingLevel: thinkingLevel === 'auto' ? undefined : (thinkingLevel as 'minimal' | 'low' | 'medium' | 'high'),
        modelKey: selectedSummaryModelKey || modelData?.defaults.summarize,
        translationModelKey,
        customPrompt: customPrompt.trim() || undefined,
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
    <div className={styles.panel}>
      {/* Top action header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerTitle}>
            <BookOpen size={20} color="var(--accent)" />
            <h3>Tóm Tắt Buổi Học</h3>
          </div>
          <span className={styles.presetBadge}>
            Kiểu: {summary?.modelKey === 'Tự biên soạn' ? 'Tự soạn' : 'Mặc định'}
          </span>
        </div>

        <div className={styles.headerControls}>
          {summaryModels.length > 0 && !isAuthoring && (
            <label className={styles.controlField}>
              <span>Model tóm tắt</span>
              <select
                aria-label="Model tóm tắt"
                value={selectedSummaryModelKey}
                onChange={(event) => {
                  setSelectedSummaryModelKey(event.target.value);
                  setThinkingLevel('auto');
                }}
                disabled={loading}
                className={styles.controlSelect}
              >
                {summaryModels.map((model) => (
                  <option key={model.key} value={model.key} disabled={model.key === translationModelKey}>
                    {model.name}
                    {model.key === translationModelKey ? ' (đang dùng để dịch)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {summaryThinkingLevels.length > 0 && !isAuthoring && (
            <label className={styles.controlField}>
              <span>Mức suy luận</span>
              <select
                aria-label="Mức suy luận tóm tắt"
                value={thinkingLevel}
                onChange={(event) => setThinkingLevel(event.target.value)}
                disabled={loading}
                className={styles.controlSelect}
              >
                <option value="auto">Tự động</option>
                {summaryThinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {({ minimal: 'Tối thiểu', low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const)[level]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {!isAuthoring ? (
              <>
                <button
                  type="button"
                  onClick={handleStartAuthoring}
                  disabled={loading}
                  className={styles.authoringBtn}
                  title="Tự nhập hoặc chỉnh sửa tóm tắt theo ý bạn"
                >
                  <span>{summary ? 'Chỉnh sửa tóm tắt' : 'Tự soạn tóm tắt'}</span>
                </button>

                <button
                  onClick={handleGenerateSummary}
                  disabled={loading || captions.length === 0}
                  className={styles.summaryActionBtn}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Đang tóm tắt...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>{summaryIsStale ? 'Tạo lại' : summary ? 'Tóm tắt lại' : 'Tóm tắt AI'}</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsAuthoring(false)}
                  className={styles.authoringCancelBtn}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleSaveAuthoring}
                  className={styles.summaryActionBtn}
                >
                  Lưu tóm tắt
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Custom Prompt input for AI summary */}
      {!isAuthoring && (
        <div className={styles.customPromptContainer}>
          <label htmlFor="custom-summary-prompt" className={styles.customPromptLabel}>
            <span>Yêu cầu tóm tắt riêng (tùy chọn theo ý bạn):</span>
          </label>
          <input
            id="custom-summary-prompt"
            type="text"
            className={styles.customPromptInput}
            placeholder="Ví dụ: Tập trung vào từ vựng mới, tóm tắt dưới 5 gạch đầu dòng, các bài tập..."
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            disabled={loading}
          />
        </div>
      )}

      {/* Manual Authoring Form */}
      {isAuthoring && (
        <div className={styles.authoringCard}>
          <div className={styles.authoringField}>
            <label>Tiêu đề tóm tắt</label>
            <input
              type="text"
              value={authorTitle}
              onChange={(e) => setAuthorTitle(e.target.value)}
              placeholder="Nhập tiêu đề tóm tắt..."
              className={styles.authoringInput}
            />
          </div>
          <div className={styles.authoringField}>
            <label>Tổng quan (khái quát nội dung)</label>
            <textarea
              rows={3}
              value={authorOverview}
              onChange={(e) => setAuthorOverview(e.target.value)}
              placeholder="Viết đoạn tổng quan ngắn gọn theo ý của bạn..."
              className={styles.authoringTextarea}
            />
          </div>
          <div className={styles.authoringField}>
            <label>Các ý chính / Ghi chú (mỗi dòng một gạch đầu dòng)</label>
            <textarea
              rows={6}
              value={authorBulletsText}
              onChange={(e) => setAuthorBulletsText(e.target.value)}
              placeholder="Nhập các điểm mấu chốt, mỗi dòng tương ứng một ý..."
              className={styles.authoringTextarea}
            />
          </div>
        </div>
      )}

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
        <div
          role="status"
          style={{
            padding: '12px 14px',
            color: '#92400e',
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.88rem',
          }}
        >
          Kịch bản đã được chỉnh sửa. Bản tóm tắt này chưa cập nhật; chọn <strong>Tạo lại</strong> để tóm tắt theo nội dung mới.
        </div>
      )}

      {summary ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={styles.overviewCard}>
            <div className={styles.overviewHeader}>
              <h2 className={styles.overviewTitle}>{summary.title}</h2>
              <span className={styles.modelBadge}>{summary.modelKey}</span>
            </div>

            <p className={styles.overviewText}>{summary.overview}</p>
          </div>

          {/* Sections */}
          {summary.sections.map((sec, idx) => (
            <div key={idx} className={styles.sectionCard}>
              <h4 className={styles.sectionHeading}>{sec.heading}</h4>
              <ul className={styles.bulletList}>
                {sec.bullets.map((b, bIdx) => (
                  <li key={bIdx} className={styles.bulletItem}>
                    {b}
                  </li>
                ))}
              </ul>

              {/* Citations references */}
              {sec.captionIds && sec.captionIds.length > 0 && (
                <div className={styles.citationRow}>
                  <span>Dẫn nguồn câu:</span>
                  {sec.captionIds.map((cid) => (
                    <button
                      key={cid}
                      onClick={() => onSelectCaption && onSelectCaption(cid)}
                      className={styles.citationPill}
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
