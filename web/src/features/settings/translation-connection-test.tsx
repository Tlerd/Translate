'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Languages, Play, Square, CheckCircle2, AlertCircle, Loader2, Sparkles, Clock } from 'lucide-react';
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
    label: 'Gemini 2.5 Flash-Lite (Nhật)',
    source: 'ja',
    target: 'vi',
    text: 'Gemini 2.5 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。',
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
  const [selectedModel, setSelectedModel] = useState<string>('google:gemini-2.5-flash-lite');
  const [thinkingLevel, setThinkingLevel] = useState<string>('auto');
  const [sourceLang, setSourceLang] = useState<string>('ja');
  const [targetLang, setTargetLang] = useState<string>('vi');
  const [inputText, setInputText] = useState<string>(
    'Gemini 2.5 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。'
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
        margin: '0 auto 24px',
        padding: '20px 24px',
        maxWidth: 840,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Languages size={20} color="var(--accent)" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Chạy thử model dịch (Translation Test)
          </h2>
        </div>
        {selectedModel === 'google:gemini-2.5-flash-lite' && (
          <span
            style={{
              fontSize: '0.78rem',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              color: 'var(--accent)',
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid var(--accent)',
              fontWeight: 500,
            }}
          >
            Đang thử nghiệm: Gemini 2.5 Flash-Lite
          </span>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        Kiểm tra trực tiếp model dịch với Google / OpenAI API: kiểm tra quyền truy cập của API key, tốc độ stream và chất lượng dịch theo thời gian thực trước khi vào buổi học.
      </p>

      {/* Model & Parameters Selection */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {/* Model Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="test-translation-model" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Model dịch thử nghiệm:
          </label>
          <select
            id="test-translation-model"
            value={selectedModel}
            onChange={(e) => {
              const newKey = e.target.value;
              setSelectedModel(newKey);
              const m = translationModels.find((mod) => mod.key === newKey);
              if (thinkingLevel !== 'auto' && !m?.thinkingLevels?.includes(thinkingLevel as 'minimal' | 'low' | 'medium' | 'high')) {
                setThinkingLevel('auto');
              }
            }}
            disabled={status === 'running'}
            style={{
              padding: '8px 10px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
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
            <label htmlFor="test-thinking-level" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Mức suy luận (Thinking Level):
            </label>
            <select
              id="test-thinking-level"
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value)}
              disabled={status === 'running'}
              style={{
                padding: '8px 10px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            >
              <option value="auto">Tự động ({selectedModel === 'google:gemini-2.5-flash-lite' ? 'Mặc định Tắt - Cực nhanh' : 'Mặc định model'})</option>
              {supportedThinkingLevels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {({ minimal: 'Tối thiểu', low: 'Thấp (Khuyên dùng)', medium: 'Vừa', high: 'Cao' } as const)[lvl]}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Direction Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="test-language-pair" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
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
              padding: '8px 10px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="ja->vi">Tiếng Nhật → Tiếng Việt (Mặc định)</option>
            <option value="en->vi">Tiếng Anh → Tiếng Việt</option>
            <option value="vi->ja">Tiếng Việt → Tiếng Nhật</option>
          </select>
        </div>
      </div>

      {/* Preset Quick Samples */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Văn bản mẫu gợi ý:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                padding: '4px 10px',
                fontSize: '0.78rem',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Text Area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="test-input-text" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Nội dung cần dịch:
        </label>
        <textarea
          id="test-input-text"
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Nhập câu tiếng Nhật hoặc ngoại ngữ cần dịch thử..."
          disabled={status === 'running'}
          style={{
            padding: '10px 12px',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {status === 'running' ? (
          <button
            type="button"
            onClick={handleStop}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              backgroundColor: 'var(--danger, #ef4444)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
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
              gap: 6,
              padding: '8px 18px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: inputText.trim() ? 'pointer' : 'not-allowed',
              opacity: inputText.trim() ? 1 : 0.6,
              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
            }}
          >
            <Play size={16} />
            <span>Chạy thử dịch</span>
          </button>
        )}

        {status === 'running' && (
          <span style={{ fontSize: '0.85rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={16} className="animate-spin" />
            <span>Đang gửi yêu cầu & nhận stream dịch...</span>
          </span>
        )}
      </div>

      {/* Output & Metrics Section */}
      {(status === 'running' || translatedText || status === 'error' || status === 'success') && (
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
          {/* Header metrics */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: '0.82rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status === 'success' && <span style={{ color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><CheckCircle2 size={16} /> Hoàn tất</span>}
              {status === 'running' && <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Sparkles size={16} /> Đang dịch stream...</span>}
              {status === 'error' && <span style={{ color: 'var(--danger, #ef4444)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><AlertCircle size={16} /> Gặp lỗi</span>}
              {usedModel && <span style={{ color: 'var(--text-muted)' }}>Model: <code>{usedModel}</code></span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)' }}>
              {ttfbMs !== null && (
                <span title="Thời gian từ khi bấm đến khi nhận token dịch đầu tiên" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={14} /> TTFB: <strong>{ttfbMs} ms</strong>
                </span>
              )}
              {totalTimeMs !== null && (
                <span title="Tổng thời gian dịch hoàn tất">
                  Tổng thời gian: <strong>{totalTimeMs} ms</strong>
                </span>
              )}
            </div>
          </div>

          {/* Translated text result */}
          {translatedText && (
            <div
              style={{
                fontSize: '0.95rem',
                color: 'var(--text-primary)',
                lineHeight: 1.6,
                padding: '10px 12px',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 4,
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
                padding: '10px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger, #ef4444)',
                borderRadius: 4,
                color: 'var(--danger, #ef4444)',
                fontSize: '0.85rem',
                lineHeight: 1.5,
              }}
            >
              <strong>Lỗi dịch:</strong> {errorMessage}
              {selectedModel === 'google:gemini-2.5-flash-lite' && (
                <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  ℹ️ <strong>Lưu ý từ tài liệu Google Gemini:</strong> Google đang giới hạn quyền sử dụng model 2.5 cho các tài khoản/key đã từng gọi model này trước đây. Nếu gặp thông báo quyền truy cập hoặc model không khả dụng, hãy chọn <code>Gemini 3.1 Flash-Lite</code> hoặc <code>Gemini 3.5 Flash-Lite</code> để dịch ổn định.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
