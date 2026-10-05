'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Database, AlertCircle, RefreshCw } from 'lucide-react';
import { fetchTranslationUsage } from '@/lib/api-client';
import type { UsageSummary } from '@/shared/usage';
import {
  type UsagePreset,
  rangePreset,
  formatTokens,
  formatUsd,
} from './usage-format';
import styles from './usage-dashboard.module.css';

export function UsageDashboard() {
  const [preset, setPreset] = useState<UsagePreset | 'custom'>('7days');
  const [dateRange, setDateRange] = useState(() => rangePreset('7days'));
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; is503: boolean } | null>(null);

  const loadUsage = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTranslationUsage({ from, to });
      setSummary(data);
    } catch (err: unknown) {
      const errObj = err as Error & { status?: number; code?: string };
      const is503 = errObj.status === 503 || errObj.code === 'MISSING_CONFIG';
      setError({
        message: errObj.message || 'Không thể tải thông tin chi phí dịch.',
        is503,
      });
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage(dateRange.from, dateRange.to);
  }, [dateRange, loadUsage]);

  const selectPreset = (newPreset: UsagePreset) => {
    setPreset(newPreset);
    const range = rangePreset(newPreset);
    setDateRange(range);
  };

  const onCustomDateChange = (from: string, to: string) => {
    setPreset('custom');
    setDateRange({ from, to });
  };

  const maxDayTokens = summary?.byDay.reduce(
    (max, d) => Math.max(max, d.inputTokens + d.outputTokens + d.thinkingTokens),
    0
  ) || 1;

  return (
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
              <span className={styles.statLabel}>Input Token</span>
              <span className={styles.statValue}>{formatTokens(summary.totals.inputTokens)}</span>
              <span className={styles.statSub}>
                TB: {formatTokens(summary.avgInputTokensPerRequest)} token/request
              </span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statLabel}>Output Token</span>
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
              <span className={styles.statSub}>Chưa tính chiết khấu cache</span>
            </div>
          </div>

          {/* Table by Day */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo ngày</h2>
              <span className={styles.sectionDesc}>Múi giờ Asia/Ho_Chi_Minh</span>
            </div>

            {summary.byDay.length === 0 ? (
              <div className={styles.empty}>Không có yêu cầu dịch nào trong khoảng thời gian này.</div>
            ) : (
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
                    {summary.byDay.map((d) => {
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

          {/* Table by Recording (Top 50) */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Theo buổi thu (Top 50)</h2>
              <span className={styles.sectionDesc}>Sắp xếp theo tổng lượng token</span>
            </div>

            {summary.byRecording.length === 0 ? (
              <div className={styles.empty}>Chưa có buổi thu nào phát sinh yêu cầu dịch.</div>
            ) : (
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
                    {summary.byRecording.map((r) => {
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
  );
}
