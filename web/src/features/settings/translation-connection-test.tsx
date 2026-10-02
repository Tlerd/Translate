'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Languages,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Clock,
} from 'lucide-react';
import { fetchModels, streamTranslate } from '@/lib/api-client';
import { loadSettings } from '@/storage/recordings';
import type { ModelsResponse } from '@/shared/ai-contracts';

const PRESET_SAMPLES = [
  {
    label: 'Chào hỏi (Nhật)',
    source: 'ja',
    target: 'vi',
    text: 'こんにちは、本日の授業を始めます。よろしくお願いします。',
  },
  {
    label: 'Gemini 3.1 Flash-Lite (Nhật)',
    source: 'ja',
    target: 'vi',
    text: 'Gemini 3.1 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。',
  },
  {
    label: 'Đàm phán thương mại (Nhật)',
    source: 'ja',
    target: 'vi',
    text: '今回の契約条件について、いくつか確認させていただきたい点がございます。納期を前倒しすることは可能でしょうか？',
  },
  {
    label: 'Tiếng Anh sang Tiếng Việt',
    source: 'en',
    target: 'vi',
    text: 'Artificial intelligence and real-time speech translation are revolutionizing language learning and cross-border communication.',
  },
  {
    label: 'Tiếng Việt sang Tiếng Nhật',
    source: 'vi',
    target: 'ja',
    text: 'Xin chào mọi người, hôm nay chúng ta sẽ cùng thảo luận về kiến trúc phần mềm và trí tuệ nhân tạo.',
  },
];

export function TranslationConnectionTest() {
  const [modelData, setModelData] = useState<ModelsResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('google:gemini-3.1-flash-lite');
  const [thinkingLevel, setThinkingLevel] = useState<string>('auto');
  const [sourceLang, setSourceLang] = useState<string>('ja');
  const [targetLang, setTargetLang] = useState<string>('vi');
  const [inputText, setInputText] = useState<string>(
    'Gemini 3.1 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。'
  );
  const [translatedText, setTranslatedText] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [ttfbMs, setTtfbMs] = useState<number | null>(null);
  const [totalTimeMs, setTotalTimeMs] = useState<number | null>(null);
  const [usedModel, setUsedModel] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      if (s?.translationModel) {
        setSelectedModel(s.translationModel);
        if (s.translationThinkingLevel) {
          setThinkingLevel(s.translationThinkingLevel);
        }
      }
    });
    fetchModels().then(setModelData).catch(console.error);
  }, []);

  const translationModels =
    modelData?.models.filter((m) => m.allowedTasks.includes('translate') && m.enabled) || [];

  const currentModelMeta = translationModels.find((m) => m.key === selectedModel);
  const supportedThinkingLevels = currentModelMeta?.thinkingLevels || [];

  const handleRunTest = async () => {
    if (!inputText.trim()) return;

    abortControllerRef.current?.abort();
    const abort = new AbortController();
    abortControllerRef.current = abort;

    setStatus('running');
    setTranslatedText('');
    setErrorMessage('');
    setTtfbMs(null);
    setTotalTimeMs(null);
    setUsedModel('');

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let accumulated = '';

    try {
      await streamTranslate(
        {
          requestId: `test_${Date.now()}`,
          recordingId: 'test_connection',
          captionId: 1,
          sessionEpoch: 1,
          revision: 1,
          configRevision: 1,
          modelKey: selectedModel,
          thinkingLevel:
            thinkingLevel === 'auto'
              ? undefined
              : (thinkingLevel as 'minimal' | 'low' | 'medium' | 'high'),
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          text: inputText.trim(),
        },
        (delta) => {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            setTtfbMs(firstTokenTime - startTime);
          }
          accumulated += delta;
          setTranslatedText((prev) => prev + delta);
        },
        (fullText, modelKey) => {
          setTotalTimeMs(Date.now() - startTime);
          setUsedModel(modelKey);
          setTranslatedText(fullText || accumulated);
          setStatus('success');
        },
        (err) => {
          setErrorMessage(err);
          setStatus('error');
        },
        abort.signal
      );
    } catch (err: unknown) {
      if (abort.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus('error');
    } finally {
      if (abortControllerRef.current === abort) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setStatus('idle');
  };

  return (
    <section
      id="translation-test"
      aria-label="Kiểm tra và chạy thử model dịch"
      style={{
        margin: '0 auto 20px',
        padding: '22px 24px',
        maxWidth: 860,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Languages size={18} color="var(--accent)" />
          </div>
          <div>
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                margin: 0,
                color: 'var(--text-primary)',
              }}
            >
              Thử Nghiệm Tốc Độ & Luồng Dịch (Translation Test)
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Đo đạc độ trễ nhận byte đầu tiên (TTFB) và tốc độ stream theo thời gian thực
            </span>
          </div>
        </div>

        <span
          style={{
            fontSize: '0.78rem',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            color: 'var(--accent)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Sparkles size={13} />
          <span>Real-time SSE Stream</span>
        </span>
      </div>

      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.86rem',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Kiểm tra trực tiếp model dịch với Google AI API: kiểm tra quyền gọi API, đo độ trễ mạng và quan sát văn bản dịch stream từng từ trước khi bắt đầu bài học.
      </p>

      {/* Model & Parameters Selection Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {/* Model Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="test-translation-model"
            style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
          >
            Model dịch thử nghiệm:
          </label>
          <select
            id="test-translation-model"
            value={selectedModel}
            onChange={(e) => {
              const newKey = e.target.value;
              setSelectedModel(newKey);
              const m = translationModels.find((mod) => mod.key === newKey);
              if (
                thinkingLevel !== 'auto' &&
                !m?.thinkingLevels?.includes(
                  thinkingLevel as 'minimal' | 'low' | 'medium' | 'high'
                )
              ) {
                setThinkingLevel('auto');
              }
            }}
            disabled={status === 'running'}
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
                {m.name} {!m.configured ? '(Chưa có API key)' : '✓ Sẵn sàng'}
              </option>
            ))}
          </select>
        </div>

        {/* Thinking Level Selector */}
        {supportedThinkingLevels.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor="test-thinking-level"
              style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              Mức suy luận (Thinking Level):
            </label>
            <select
              id="test-thinking-level"
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value)}
              disabled={status === 'running'}
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
              }}
            >
              <option value="auto">Tự động (Theo mặc định model)</option>
              {supportedThinkingLevels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {
                    (
                      {
                        minimal: 'Tối thiểu (Cực nhanh)',
                        low: 'Thấp (Khuyên dùng)',
                        medium: 'Vừa',
                        high: 'Cao',
                      } as const
                    )[lvl]
                  }
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Direction Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="test-language-pair"
            style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
          >
            Cặp ngôn ngữ:
          </label>
          <select
            id="test-language-pair"
            value={`${sourceLang}->${targetLang}`}
            onChange={(e) => {
              const [src, tgt] = e.target.value.split('->');
              setSourceLang(src);
              setTargetLang(tgt);
            }}
            disabled={status === 'running'}
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.88rem',
            }}
          >
            <option value="ja->vi">Tiếng Nhật → Tiếng Việt (Mặc định)</option>
            <option value="en->vi">Tiếng Anh → Tiếng Việt</option>
            <option value="vi->ja">Tiếng Việt → Tiếng Nhật</option>
          </select>
        </div>
      </div>

      {/* Preset Quick Samples */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            fontWeight: 500,
          }}
        >
          Câu mẫu thử nhanh:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PRESET_SAMPLES.map((sample, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setInputText(sample.text);
                setSourceLang(sample.source);
                setTargetLang(sample.target);
              }}
              disabled={status === 'running'}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-full)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Text Area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          htmlFor="test-input-text"
          style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}
        >
          Văn bản cần dịch thử:
        </label>
        <textarea
          id="test-input-text"
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Nhập câu tiếng Nhật hoặc ngoại ngữ cần dịch thử..."
          disabled={status === 'running'}
          style={{
            padding: '12px 14px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: '0.88rem',
            lineHeight: 1.5,
            resize: 'vertical',
          }}
        />
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {status === 'running' ? (
          <button
            type="button"
            onClick={handleStop}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              backgroundColor: 'var(--danger, #ef4444)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
            }}
          >
            <Square size={16} />
            <span>Dừng thử nghiệm</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleRunTest()}
            disabled={!inputText.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 22px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: inputText.trim() ? 'pointer' : 'not-allowed',
              opacity: inputText.trim() ? 1 : 0.6,
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.35)',
              transition: 'all 0.15s ease',
            }}
          >
            <Play size={16} />
            <span>Chạy thử dịch</span>
          </button>
        )}

        {status === 'running' && (
          <span
            style={{
              fontSize: '0.85rem',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Loader2 size={16} className="animate-spin" />
            <span>Đang gửi yêu cầu & nhận stream dịch...</span>
          </span>
        )}
      </div>

      {/* Output & Metrics Section */}
      {(status === 'running' || translatedText || status === 'error' || status === 'success') && (
        <div
          style={{
            padding: '16px 18px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Header metrics bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              fontSize: '0.84rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {status === 'success' && (
                <span
                  style={{
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={16} /> Hoàn tất
                </span>
              )}
              {status === 'running' && (
                <span
                  style={{
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 600,
                  }}
                >
                  <Sparkles size={16} /> Đang dịch stream...
                </span>
              )}
              {status === 'error' && (
                <span
                  style={{
                    color: 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 600,
                  }}
                >
                  <AlertCircle size={16} /> Gặp lỗi
                </span>
              )}
              {usedModel && (
                <span
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '2px 8px',
                    borderRadius: 4,
                  }}
                >
                  Model: <code>{usedModel}</code>
                </span>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                color: 'var(--text-secondary)',
                fontSize: '0.82rem',
              }}
            >
              {ttfbMs !== null && (
                <span
                  title="Thời gian từ khi bấm đến khi nhận token dịch đầu tiên"
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Clock size={14} color="var(--accent)" />
                  TTFB: <strong style={{ color: 'var(--text-primary)' }}>{ttfbMs} ms</strong>
                </span>
              )}
              {totalTimeMs !== null && (
                <span title="Tổng thời gian hoàn tất bản dịch">
                  Tổng thời gian: <strong style={{ color: 'var(--text-primary)' }}>{totalTimeMs} ms</strong>
                </span>
              )}
            </div>
          </div>

          {/* Translated text result */}
          {translatedText && (
            <div
              style={{
                fontSize: '0.96rem',
                color: 'var(--text-primary)',
                lineHeight: 1.65,
                padding: '12px 16px',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-sm)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderLeft: '3px solid var(--accent)',
              }}
            >
              {translatedText}
            </div>
          )}

          {/* Error Message */}
          {status === 'error' && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--danger)',
                fontSize: '0.86rem',
                lineHeight: 1.5,
              }}
            >
              <strong>Lỗi dịch:</strong> {errorMessage}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
