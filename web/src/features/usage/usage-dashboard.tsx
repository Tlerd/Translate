'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Database, AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchSpeechUsage, fetchTranslationUsage } from '@/lib/api-client';
import { SPEECH_PRICING_AS_OF } from '@/shared/speech-pricing';
import { speechProviderName } from '@/shared/transcription';
import type { SpeechUsageSummary, UsageSummary } from '@/shared/usage';
import {
  type UsagePreset,
  rangePreset,
  formatTokens,
  formatUsd,
  formatClock,
  formatDurationVi,
  formatUsdPerMinute,
  combineEstimatedUsd,
} from './usage-format';
import styles from './usage-dashboard.module.css';

const PAGE_SIZE = 10;

export function UsageDashboard() {
  const [preset, setPreset] = useState<UsagePreset | 'custom'>('7days');
  const [dateRange, setDateRange] = useState(() => rangePreset('7days'));
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [speech, setSpeech] = useState<SpeechUsageSummary | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; is503: boolean } | null>(null);
  const [pageByDay, setPageByDay] = useState(1);
  const [pageByRecording, setPageByRecording] = useState(1);
  const [pageSpeechDay, setPageSpeechDay] = useState(1);

  const loadUsage = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const [translation, speechResult] = await Promise.allSettled([
        fetchTranslationUsage({ from, to }),
        fetchSpeechUsage({ from, to }),
      ]);
      if (translation.status === 'rejected') throw translation.reason;
      setSummary(translation.value);
      // Speech usage is additive: its failure must not hide translation usage.
      setSpeech(speechResult.status === 'fulfilled' ? speechResult.value : null);
      setSpeechError(
        speechResult.status === 'fulfilled'
          ? null
          : (speechResult.reason as Error)?.message || 'Không thể tải thống kê nhận giọng nói.'
      );
    } catch (err: unknown) {
      const errObj = err as Error & { status?: number; code?: string };
      const is503 = errObj.status === 503 || errObj.code === 'MISSING_CONFIG';
      setError({
        message: errObj.message || 'Không thể tải thông tin chi phí dịch.',
        is503,
      });
      setSummary(null);
      setSpeech(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage(dateRange.from, dateRange.to);
  }, [dateRange, loadUsage]);

  const selectPreset = (newPreset: UsagePreset) => {
    setPreset(newPreset);
    setPageByDay(1);
    setPageByRecording(1);
    setPageSpeechDay(1);
    const range = rangePreset(newPreset);
    setDateRange(range);
  };

  const onCustomDateChange = (from: string, to: string) => {
    setPreset('custom');
    setPageByDay(1);
    setPageByRecording(1);
    setPageSpeechDay(1);
    setDateRange({ from, to });
  };

  const maxDayTokens = summary?.byDay.reduce(
    (max, d) => Math.max(max, d.inputTokens + d.outputTokens + d.thinkingTokens),
    0
  ) || 1;

  const totalDayPages = Math.max(1, Math.ceil((summary?.byDay.length ?? 0) / PAGE_SIZE));
  const pagedByDay = summary?.byDay.slice((pageByDay - 1) * PAGE_SIZE, pageByDay * PAGE_SIZE) ?? [];

  const totalRecordingPages = Math.max(1, Math.ceil((summary?.byRecording.length ?? 0) / PAGE_SIZE));
  const pagedByRecording = summary?.byRecording.slice((pageByRecording - 1) * PAGE_SIZE, pageByRecording * PAGE_SIZE) ?? [];

  const speechDays = speech?.byDay ?? [];
  const maxSpeechDayMs = speechDays.reduce((max, d) => Math.max(max, d.audioMs), 0) || 1;
  const totalSpeechDayPages = Math.max(1, Math.ceil(speechDays.length / PAGE_SIZE));
  const pagedSpeechDays = speechDays.slice((pageSpeechDay - 1) * PAGE_SIZE, pageSpeechDay * PAGE_SIZE);
  const combined = summary ? combineEstimatedUsd(summary.totals.estimatedUsd, speech?.totals.estimatedUsd ?? 0) : null;

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>Chi Phí & Token Dịch</h1>
          <p className={styles.subtitle}>
            Theo dõi lượng token và chi phí ước tính theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
          </p>
        </div>

        <div className={styles.controls}>
          <div className={styles.presets}>
            <button
              className={`${styles.presetButton} ${preset === 'today' ? styles.presetButtonActive : ''}`}
              onClick={() => selectPreset('today')}
            >
              Hôm nay
            </button>
            <button
              className={`${styles.presetButton} ${preset === '7days' ? styles.presetButtonActive : ''}`}
              onClick={() => selectPreset('7days')}
            >
              7 ngày
            </button>
            <button
              className={`${styles.presetButton} ${preset === '30days' ? styles.presetButtonActive : ''}`}
              onClick={() => selectPreset('30days')}
            >
              30 ngày
            </button>
          </div>

          <div className={styles.customRange}>
            <span>Từ</span>
            <input
              type="date"
              className={styles.dateInput}
              value={dateRange.from}
              onChange={(e) => onCustomDateChange(e.target.value, dateRange.to)}
            />
            <span>đến</span>
            <input
              type="date"
              className={styles.dateInput}
              value={dateRange.to}
              onChange={(e) => onCustomDateChange(dateRange.from, e.target.value)}
            />
            <button
              className={styles.presetButton}
              onClick={() => void loadUsage(dateRange.from, dateRange.to)}
              title="Tải lại"
              disabled={loading}
            >
              <RefreshCw size={13} style={{ verticalAlign: 'middle' }} />
            </button>
          </div>
        </div>
      </header>

      {error?.is503 ? (
        <div className={styles.noticeCard}>
          <Database size={28} color="var(--accent)" />
          <div>
            <div className={styles.noticeTitle}>Chưa cấu hình cơ sở dữ liệu lưu trữ usage</div>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Tính năng theo dõi token và chi phí cần kết nối Postgres (Neon). Vui lòng cấu hình{' '}
              <code>DATABASE_URL</code> trong file <code>.env.local</code> và đảm bảo{' '}
              <code>TRANSLATION_USAGE_STORE=on</code>.
            </p>
          </div>
        </div>
      ) : error ? (
        <div className={styles.noticeCard} style={{ borderColor: 'var(--danger)' }}>
          <AlertCircle size={28} color="var(--danger)" />
          <div>
            <div className={styles.noticeTitle}>Lỗi tải dữ liệu</div>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>{error.message}</p>
          </div>
        </div>
      ) : summary ? (
        <>
          {/* Metrics summary cards */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Tổng Request</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.requests)}</span>
              <span className={styles.statSub}>
                {summary.totals.byStatus.completed} thành công · {summary.totals.byStatus.aborted} hủy
              </span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Input Token đã ghi nhận</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.inputTokens)}</span>
              <span className={styles.statSub}>
                TB: {formatTokens(summary.avgInputTokensPerRequest)} token/request
              </span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Output Token đã ghi nhận</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.outputTokens)}</span>
              <span className={styles.statSub}>Bản dịch trả về</span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Thinking Token</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.thinkingTokens)}</span>
              <span className={styles.statSub}>Suy luận provider</span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Cached Input</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.cachedInputTokens)}</span>
              <span className={styles.statSub}>Nội dung tái sử dụng</span>
            </div>

            <div className={styles.statCard} style={{ borderColor: 'var(--accent)' }}>
              <span className={styles.statLabel} style={{ color: 'var(--accent)' }}>Ước Tính Chi Phí</span>
              <span className={styles.statValue} style={{ color: 'var(--accent)' }}>
                {formatUsd(summary.totals.estimatedUsd)}
              </span>
              <span className={styles.statSub}>Theo token đã báo cáo, đã tách giá cache</span>
            </div>

            <div className={styles.statCard} style={{ borderColor: 'var(--accent)' }}>
              <span className={styles.statLabel} style={{ color: 'var(--accent)' }}>Tổng ước tính (dịch + nhận giọng)</span>
              <span className={styles.statValue} style={{ color: 'var(--accent)' }}>
                {combined ? formatUsd(combined.usd) : formatUsd(null)}
              </span>
              <span className={styles.statSub}>
                {combined?.partial
                  ? 'Chưa gồm chi phí dịch chưa rõ'
                  : speech
                  ? 'Dịch bằng token + nhận giọng theo thời gian'
                  : 'Chưa có dữ liệu nhận giọng'}
              </span>
            </div>
          </div>

          <p className={styles.subtitle}>
            Có metadata đầy đủ: {summary.totals.requests - summary.totals.unavailable}/{summary.totals.requests} request.
            {summary.totals.unavailable > 0 && ' Chi phí chỉ phản ánh phần token đã nhận; request thiếu metadata hoặc bị hủy vẫn có thể bị tính phí.'}
            {' '}Đây là ước tính dịch, không phải tổng hóa đơn. Dữ liệu lưu thất bại có thể thiếu khỏi báo cáo.
            {' '}Đơn giá kiểm tra ngày 05/10/2026; chưa gồm thuế, lưu trữ cache và dịch vụ audio.
          </p>

          {/* Speech recognition (live) */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Nhận giọng nói (Live)</h2>
              <span className={styles.sectionDesc}>Thời gian nhận giọng và chi phí ước tính</span>
            </div>

            {speechError ? (
              <div className={styles.empty}>Không tải được thống kê nhận giọng nói: {speechError}</div>
            ) : speech ? (
              <>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>Tổng thời gian nhận giọng</span>
                    <span className={styles.statValue}>{formatDurationVi(speech.totals.audioMs)}</span>
                    <span className={styles.statSub}>
                      {formatClock(speech.totals.audioMs, true)} · {formatTokens(speech.totals.sessions)} phiên
                    </span>
                  </div>
                  <div className={styles.statCard} style={{ borderColor: 'var(--accent)' }}>
                    <span className={styles.statLabel} style={{ color: 'var(--accent)' }}>Ước tính chi phí nhận giọng</span>
                    <span className={styles.statValue} style={{ color: 'var(--accent)' }}>
                      {formatUsd(speech.totals.estimatedUsd)}
                    </span>
                    <span className={styles.statSub}>Theo thời gian × đơn giá/phút</span>
                  </div>
                </div>

                {speech.byProvider.length === 0 ? (
                  <div className={styles.empty}>Chưa có phiên nhận giọng nào trong khoảng thời gian này.</div>
                ) : (
                  <>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Tên model</th>
                            <th className={styles.thRight}>Số phiên</th>
                            <th className={styles.thRight}>Thời gian</th>
                            <th className={styles.thRight}>Đơn giá/phút</th>
                            <th className={styles.thRight}>Ước tính USD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {speech.byProvider.map((p) => (
                            <tr key={`${p.provider}|${p.model}|${p.translated}`}>
                              <td className={styles.td} style={{ fontWeight: 500 }}>
                                <div>{p.model}</div>
                                <div className={styles.sectionDesc}>
                                  {speechProviderName(p.provider)}{p.provider === 'soniox' && p.translated ? ' · có dịch' : ''}
                                </div>
                              </td>
                              <td className={styles.tdRight}>{formatTokens(p.sessions)}</td>
                              <td className={styles.tdRight}>{formatClock(p.audioMs, true)}</td>
                              <td className={styles.tdRight}>{formatUsdPerMinute(p.usdPerMinute)}</td>
                              <td className={styles.tdRight}>{formatUsd(p.estimatedUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className={styles.sectionHeader}>
                      <h3 className={styles.sectionTitle}>Nhận giọng theo ngày</h3>
                      <span className={styles.sectionDesc}>Tính theo ngày bắt đầu phiên</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Ngày</th>
                            <th className={styles.thRight}>Thời gian</th>
                            <th className={styles.thRight}>Ước tính USD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedSpeechDays.map((d) => {
                            const percent = Math.min(100, Math.round((d.audioMs / maxSpeechDayMs) * 100));
                            return (
                              <tr key={d.date}>
                                <td className={styles.td}>
                                  <div>{d.date}</div>
                                  <div className={styles.barTrack}>
                                    <div className={styles.barFill} style={{ width: `${percent}%` }} />
                                  </div>
                                </td>
                                <td className={styles.tdRight}>{formatClock(d.audioMs, true)}</td>
                                <td className={styles.tdRight}>{formatUsd(d.estimatedUsd)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {totalSpeechDayPages > 1 && (
                      <div className={styles.pagination}>
                        <span className={styles.pageInfo}>
                          Trang {pageSpeechDay} / {totalSpeechDayPages} ({speechDays.length} ngày)
                        </span>
                        <button
                          type="button"
                          className={styles.pageBtn}
                          onClick={() => setPageSpeechDay((p) => Math.max(1, p - 1))}
                          disabled={pageSpeechDay <= 1}
                          aria-label="Trang trước"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          type="button"
                          className={styles.pageBtn}
                          onClick={() => setPageSpeechDay((p) => Math.min(totalSpeechDayPages, p + 1))}
                          disabled={pageSpeechDay >= totalSpeechDayPages}
                          aria-label="Trang sau"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </>
                )}

                <p className={styles.subtitle}>
                  Giá chỉ là ước tính tại ngày {SPEECH_PRICING_AS_OF}, không phải hóa đơn. Soniox tính theo thời gian
                  mở stream; Gemini tính theo audio token (quy đổi theo phút audio). Nemotron tự host nên chỉ theo dõi
                  thời gian ($0).
                </p>
              </>
            ) : null}
          </section>

          {/* Table by Day */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo ngày</h2>
              <span className={styles.sectionDesc}>Múi giờ Asia/Ho_Chi_Minh</span>
            </div>

            {summary.byDay.length === 0 ? (
              <div className={styles.empty}>Không có yêu cầu dịch nào trong khoảng thời gian này.</div>
            ) : (
              <>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Ngày</th>
                        <th className={styles.thRight}>Request</th>
                        <th className={styles.thRight}>Input</th>
                        <th className={styles.thRight}>Output</th>
                        <th className={styles.thRight}>Thinking</th>
                        <th className={styles.thRight}>Tổng Token</th>
                        <th className={styles.thRight}>Ước tính USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByDay.map((d) => {
                        const totalTokens = d.inputTokens + d.outputTokens + d.thinkingTokens;
                        const percent = Math.min(100, Math.round((totalTokens / maxDayTokens) * 100));
                        return (
                          <tr key={d.day}>
                            <td className={styles.td}>
                              <div>{d.day}</div>
                              <div className={styles.barTrack}>
                                <div className={styles.barFill} style={{ width: `${percent}%` }} />
                              </div>
                            </td>
                            <td className={styles.tdRight}>{formatTokens(d.requests)}</td>
                            <td className={styles.tdRight}>{formatTokens(d.inputTokens)}</td>
                            <td className={styles.tdRight}>{formatTokens(d.outputTokens)}</td>
                            <td className={styles.tdRight}>{formatTokens(d.thinkingTokens)}</td>
                            <td className={styles.tdRight} style={{ fontWeight: 600 }}>{formatTokens(totalTokens)}</td>
                            <td className={styles.tdRight}>{formatUsd(d.estimatedUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalDayPages > 1 && (
                  <div className={styles.pagination}>
                    <span className={styles.pageInfo}>
                      Trang {pageByDay} / {totalDayPages} ({summary.byDay.length} ngày)
                    </span>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      onClick={() => setPageByDay((p) => Math.max(1, p - 1))}
                      disabled={pageByDay <= 1}
                      aria-label="Trang trước"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      onClick={() => setPageByDay((p) => Math.min(totalDayPages, p + 1))}
                      disabled={pageByDay >= totalDayPages}
                      aria-label="Trang sau"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Table by Request Kind */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo loại request</h2>
              <span className={styles.sectionDesc}>Phân bổ giữa dịch câu chốt và dịch sớm</span>
            </div>

            {summary.byKind.length === 0 ? (
              <div className={styles.empty}>Không có dữ liệu phân loại.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Loại</th>
                      <th className={styles.thRight}>Request</th>
                      <th className={styles.thRight}>Input</th>
                      <th className={styles.thRight}>Output</th>
                      <th className={styles.thRight}>Thinking</th>
                      <th className={styles.thRight}>Ước tính USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byKind.map((k) => {
                      const badgeClass =
                        k.requestKind === 'final'
                          ? styles.badgeFinal
                          : k.requestKind === 'segment'
                          ? styles.badgeSegment
                          : styles.badgeRemainder;
                      const kindLabel =
                        k.requestKind === 'final'
                          ? 'Final (Câu chốt)'
                          : k.requestKind === 'segment'
                          ? 'Segment (Đoạn sớm)'
                          : 'Remainder (Phần còn lại)';

                      return (
                        <tr key={k.requestKind}>
                          <td className={styles.td}>
                            <span className={`${styles.badge} ${badgeClass}`}>{kindLabel}</span>
                          </td>
                          <td className={styles.tdRight}>{formatTokens(k.requests)}</td>
                          <td className={styles.tdRight}>{formatTokens(k.inputTokens)}</td>
                          <td className={styles.tdRight}>{formatTokens(k.outputTokens)}</td>
                          <td className={styles.tdRight}>{formatTokens(k.thinkingTokens)}</td>
                          <td className={styles.tdRight}>{formatUsd(k.estimatedUsd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Table by Model */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo Model AI</h2>
            </div>

            {summary.byModel.length === 0 ? (
              <div className={styles.empty}>Không có dữ liệu model.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Model</th>
                      <th className={styles.thRight}>Request</th>
                      <th className={styles.thRight}>Input</th>
                      <th className={styles.thRight}>Output</th>
                      <th className={styles.thRight}>Thinking</th>
                      <th className={styles.thRight}>Ước tính USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byModel.map((m) => (
                      <tr key={m.modelKey}>
                        <td className={styles.td} style={{ fontWeight: 500 }}>{m.modelKey}</td>
                        <td className={styles.tdRight}>{formatTokens(m.requests)}</td>
                        <td className={styles.tdRight}>{formatTokens(m.inputTokens)}</td>
                        <td className={styles.tdRight}>{formatTokens(m.outputTokens)}</td>
                        <td className={styles.tdRight}>{formatTokens(m.thinkingTokens)}</td>
                        <td className={styles.tdRight}>{formatUsd(m.estimatedUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Table by Recording */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo buổi thu</h2>
              <span className={styles.sectionDesc}>Sắp xếp theo tổng lượng token</span>
            </div>

            {summary.byRecording.length === 0 ? (
              <div className={styles.empty}>Chưa có buổi thu nào phát sinh yêu cầu dịch.</div>
            ) : (
              <>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Buổi thu</th>
                        <th className={styles.thRight}>Request</th>
                        <th className={styles.thRight}>Input</th>
                        <th className={styles.thRight}>Output</th>
                        <th className={styles.thRight}>Tổng Token</th>
                        <th className={styles.thRight}>Ước tính USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByRecording.map((r) => {
                        const totalTokens = r.inputTokens + r.outputTokens + r.thinkingTokens;
                        return (
                          <tr key={r.recordingId}>
                            <td className={styles.td}>
                              <Link href={`/recordings/${r.recordingId}`} className={styles.link}>
                                #{r.recordingId}
                              </Link>
                            </td>
                            <td className={styles.tdRight}>{formatTokens(r.requests)}</td>
                            <td className={styles.tdRight}>{formatTokens(r.inputTokens)}</td>
                            <td className={styles.tdRight}>{formatTokens(r.outputTokens)}</td>
                            <td className={styles.tdRight} style={{ fontWeight: 600 }}>{formatTokens(totalTokens)}</td>
                            <td className={styles.tdRight}>{formatUsd(r.estimatedUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalRecordingPages > 1 && (
                  <div className={styles.pagination}>
                    <span className={styles.pageInfo}>
                      Trang {pageByRecording} / {totalRecordingPages} ({summary.byRecording.length} buổi)
                    </span>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      onClick={() => setPageByRecording((p) => Math.max(1, p - 1))}
                      disabled={pageByRecording <= 1}
                      aria-label="Trang trước"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      onClick={() => setPageByRecording((p) => Math.min(totalRecordingPages, p + 1))}
                      disabled={pageByRecording >= totalRecordingPages}
                      aria-label="Trang sau"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Reliability and Status */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Trạng thái thực thi</h2>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <div>Thành công: <strong>{summary.totals.byStatus.completed}</strong></div>
              <div>Hủy (aborted): <strong>{summary.totals.byStatus.aborted}</strong></div>
              <div>Thất bại: <strong>{summary.totals.byStatus.failed}</strong></div>
              <div>Chưa có metadata provider (unavailable): <strong>{summary.totals.unavailable}</strong></div>
            </div>
          </section>
        </>
      ) : null}
      </div>
    </div>
  );
}
