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
import type { TranslationMetrics } from '@/shared/usage';
import shared from './settings-shared.module.css';
import styles from './translation-connection-test.module.css';

const PRESET_SAMPLES = [
  {
    label: 'Chào hỏi (Nhật)',
    source: 'ja',
    target: 'vi',
    text: 'こんにちは、本日の授業を始めます。よろしくお願いします。',
  },
  {
    label: 'Gemini 3.5 Flash-Lite (Nhật)',
    source: 'ja',
    target: 'vi',
    text: 'Gemini 3.5 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。',
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
  const [selectedModel, setSelectedModel] = useState<string>('google:gemini-3.5-flash-lite');
  const [thinkingLevel, setThinkingLevel] = useState<string>('auto');
  const [sourceLang, setSourceLang] = useState<string>('ja');
  const [targetLang, setTargetLang] = useState<string>('vi');
  const [inputText, setInputText] = useState<string>(
    'Gemini 3.5 Flash-Liteは、超低レイテンシかつ高コスト効率でリアルタイム翻訳に最適なモデルです。'
  );
  const [translatedText, setTranslatedText] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [ttfbMs, setTtfbMs] = useState<number | null>(null);
  const [totalTimeMs, setTotalTimeMs] = useState<number | null>(null);
  const [usedModel, setUsedModel] = useState<string>('');
  const [historyLimit, setHistoryLimit] = useState(0);
  const [historyText, setHistoryText] = useState('');
  const [usage, setUsage] = useState<TranslationMetrics | null>(null);

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
    const turns: Array<{ source: string; translation: string }> = [];
    if (historyLimit > 0) {
      for (const line of historyText.split('\n').filter((line) => line.trim())) {
        const match = line.match(/^(.+?)\s(?:->|→)\s(.+)$/);
        if (!match) { setErrorMessage('Mỗi dòng ngữ cảnh cần có dạng: câu nguồn → bản dịch.'); setStatus('error'); return; }
        turns.push({ source: match[1].trim(), translation: match[2].trim() });
      }
    }

    abortControllerRef.current?.abort();
    const abort = new AbortController();
    abortControllerRef.current = abort;

    setStatus('running');
    setTranslatedText('');
    setErrorMessage('');
    setTtfbMs(null);
    setTotalTimeMs(null);
    setUsedModel('');
    setUsage(null);

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
          previousTurns: historyLimit === 0 ? [] : turns.slice(-historyLimit),
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
        abort.signal,
        setUsage
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

  const running = status === 'running';

  return (
    <section id="translation-test" aria-label="Kiểm tra và chạy thử model dịch" className={shared.card}>
      <div className={shared.cardHead}>
        <div className={shared.cardHeadMain}>
          <span className={shared.cardIcon}>
            <Languages size={18} aria-hidden="true" />
          </span>
          <div className={shared.cardText}>
            <h3 className={shared.cardTitle}>Thử nghiệm dịch</h3>
            <p className={shared.cardDescription}>Đo độ trễ nhận byte đầu tiên (TTFB) và tốc độ stream theo thời gian thực.</p>
          </div>
        </div>
        <div className={shared.cardHeadAside}>
          <span className={`${shared.badge} ${shared.badgeInfo}`}>
            <Sparkles size={14} aria-hidden="true" />
            <span>Stream SSE</span>
          </span>
        </div>
      </div>

      <p className={shared.hint}>
        Kiểm tra trực tiếp model dịch với Google AI API: quyền gọi API, độ trễ mạng và văn bản dịch stream từng từ trước khi bắt đầu bài học.
      </p>

      {/* Model, thinking level and language pair */}
      <div className={shared.grid}>
        <div className={shared.field}>
          <label htmlFor="test-translation-model" className={shared.label}>Model dịch thử nghiệm</label>
          <select
            id="test-translation-model"
            className={shared.control}
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
            disabled={running}
          >
            {translationModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} {!m.configured ? '(Chưa có API key)' : '✓ Sẵn sàng'}
              </option>
            ))}
          </select>
        </div>

        {supportedThinkingLevels.length > 0 && (
          <div className={shared.field}>
            <label htmlFor="test-thinking-level" className={shared.label}>Mức suy luận (Thinking Level)</label>
            <select
              id="test-thinking-level"
              className={shared.control}
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value)}
              disabled={running}
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

        <div className={shared.field}>
          <label htmlFor="test-language-pair" className={shared.label}>Cặp ngôn ngữ</label>
          <select
            id="test-language-pair"
            className={shared.control}
            value={`${sourceLang}->${targetLang}`}
            onChange={(e) => {
              const [src, tgt] = e.target.value.split('->');
              setSourceLang(src);
              setTargetLang(tgt);
            }}
            disabled={running}
          >
            <option value="ja->vi">Tiếng Nhật → Tiếng Việt (Mặc định)</option>
            <option value="en->vi">Tiếng Anh → Tiếng Việt</option>
            <option value="vi->ja">Tiếng Việt → Tiếng Nhật</option>
          </select>
        </div>
      </div>

      {/* Preset samples */}
      <div className={styles.presetBlock}>
        <span id="test-presets-label" className={shared.label}>Câu mẫu thử nhanh</span>
        <div className={styles.presetList} role="group" aria-labelledby="test-presets-label">
          {PRESET_SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className={shared.chip}
              onClick={() => {
                setInputText(sample.text);
                setSourceLang(sample.source);
                setTargetLang(sample.target);
              }}
              disabled={running}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      <div className={shared.field}>
        <label htmlFor="test-input-text" className={shared.label}>Văn bản cần dịch thử</label>
        <textarea
          id="test-input-text"
          className={`${shared.control} ${shared.textarea}`}
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Nhập câu tiếng Nhật hoặc ngoại ngữ cần dịch thử..."
          disabled={running}
        />
      </div>

      <details className={shared.disclosure}>
        <summary className={shared.disclosureSummary}>Thử số câu ngữ cảnh</summary>
        <div className={shared.disclosureBody}>
          <p className={shared.hint}>
            Chỉ áp dụng cho lượt thử này, không đổi cài đặt buổi học. Mỗi dòng là một cặp nguồn/bản dịch; ưu tiên các dòng cuối.
          </p>
          <div className={shared.field}>
            <label htmlFor="test-history-limit" className={shared.label}>Số câu ngữ cảnh thử</label>
            <select
              id="test-history-limit"
              className={shared.control}
              value={historyLimit}
              disabled={running}
              onChange={(e) => setHistoryLimit(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} câu</option>)}
            </select>
          </div>
          <div className={shared.field}>
            <label htmlFor="test-history-text" className={shared.label}>Các câu trước (nguồn → bản dịch)</label>
            <textarea
              id="test-history-text"
              className={`${shared.control} ${shared.textarea}`}
              value={historyText}
              rows={6}
              disabled={running}
              onChange={(e) => setHistoryText(e.target.value)}
              placeholder="今日は授業です。 → Hôm nay có giờ học."
            />
          </div>
        </div>
      </details>

      {/* Actions */}
      <div className={shared.actionRow}>
        {running ? (
          <button type="button" className={`${shared.btn} ${shared.btnDanger}`} onClick={handleStop}>
            <Square size={16} aria-hidden="true" />
            <span>Dừng thử nghiệm</span>
          </button>
        ) : (
          <button
            type="button"
            className={`${shared.btn} ${shared.btnPrimary}`}
            onClick={() => void handleRunTest()}
            disabled={!inputText.trim()}
          >
            <Play size={16} aria-hidden="true" />
            <span>Chạy thử dịch</span>
          </button>
        )}

        {running && (
          <span role="status" className={styles.runningText}>
            <Loader2 size={16} aria-hidden="true" className={shared.spin} />
            <span>Đang gửi yêu cầu & nhận stream dịch...</span>
          </span>
        )}
      </div>

      {/* Output and metrics */}
      {(running || translatedText || status === 'error' || status === 'success') && (
        <div className={styles.result}>
          <div className={styles.metricsBar}>
            <div className={styles.metricGroup}>
              {status === 'success' && (
                <span className={`${shared.badge} ${shared.badgeSuccess}`}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Hoàn tất</span>
                </span>
              )}
              {running && (
                <span className={`${shared.badge} ${shared.badgeInfo}`}>
                  <Sparkles size={16} aria-hidden="true" />
                  <span>Đang dịch stream...</span>
                </span>
              )}
              {status === 'error' && (
                <span className={`${shared.badge} ${shared.badgeError}`}>
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>Gặp lỗi</span>
                </span>
              )}
              {usedModel && (
                <span className={styles.metaText}>
                  Model: <code className={shared.code}>{usedModel}</code>
                </span>
              )}
            </div>

            <div className={styles.metricValues}>
              {ttfbMs !== null && (
                <span title="Thời gian từ khi bấm đến khi nhận token dịch đầu tiên" className={styles.metric}>
                  <Clock size={14} color="currentColor" aria-hidden="true" />
                  TTFB: <strong>{ttfbMs} ms</strong>
                </span>
              )}
              {totalTimeMs !== null && (
                <span title="Tổng thời gian hoàn tất bản dịch" className={styles.metric}>
                  Tổng thời gian: <strong>{totalTimeMs} ms</strong>
                </span>
              )}
            </div>
          </div>

          {usage && (
            <p data-testid="translation-test-usage" className={shared.hint}>
              Request: {usage.requestId} · Ngữ cảnh thực gửi: {usage.historyTurns} · Prompt: {usage.promptVersion}<br />
              Input: {usage.inputTokens ?? 'chưa rõ'} · Output: {usage.outputTokens ?? 'chưa rõ'} · Thinking: {usage.thinkingTokens ?? 'không báo cáo'} · Cache: {usage.cachedInputTokens ?? 'không báo cáo'}
            </p>
          )}

          {translatedText && (
            <div data-testid="translation-test-output" className={styles.output}>
              {translatedText}
            </div>
          )}

          {status === 'error' && (
            <div role="alert" className={`${shared.notice} ${shared.noticeError}`}>
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Lỗi dịch:</strong> {errorMessage}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
