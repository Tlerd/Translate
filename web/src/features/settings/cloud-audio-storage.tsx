'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { cleanupOrphanAudio, fetchAudioStorageReport } from '@/lib/api-client';
import { formatMegabytes, type AudioStorageReport } from '@/shared/audio-storage';
import shared from './settings-shared.module.css';
import styles from './cloud-audio-storage.module.css';

type Busy = 'loading' | 'cleaning' | null;

export function CloudAudioStorage() {
  const [report, setReport] = useState<AudioStorageReport | null>(null);
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(true);

  const check = useCallback(async () => {
    const mine = ++generation.current;
    setBusy('loading'); setError(null); setResult(null);
    try {
      const next = await fetchAudioStorageReport();
      if (active.current && generation.current === mine) setReport(next);
    } catch (caught) {
      if (active.current && generation.current === mine) {
        setError(caught instanceof Error ? caught.message : 'Chưa kiểm tra được dung lượng audio trên cloud.');
      }
    } finally {
      if (active.current && generation.current === mine) setBusy(null);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void check();
    return () => { active.current = false; };
  }, [check]);

  const clean = async () => {
    if (!report || report.orphanFiles === 0) return;
    const ok = window.confirm(
      `Xóa vĩnh viễn ${report.orphanFiles} file audio mồ côi (${formatMegabytes(report.orphanBytes)}) khỏi kho cloud? ` +
      'Chỉ file không thuộc buổi ghi nào và đã upload hơn 2 giờ mới bị xóa. Không thể hoàn tác.'
    );
    if (!ok) return;
    const mine = ++generation.current;
    setBusy('cleaning'); setError(null); setResult(null);
    try {
      const done = await cleanupOrphanAudio();
      if (!active.current || generation.current !== mine) return;
      setReport(done.report);
      setResult(
        `Đã xóa ${done.deletedFiles} file, giải phóng ${formatMegabytes(done.freedBytes)}` +
        (done.remaining > 0 ? `. Còn ${done.remaining} file mồ côi, bấm dọn lần nữa.` : '')
      );
    } catch (caught) {
      if (active.current && generation.current === mine) {
        setError(caught instanceof Error ? caught.message : 'Chưa dọn được audio mồ côi.');
      }
    } finally {
      if (active.current && generation.current === mine) setBusy(null);
    }
  };

  const working = busy !== null;
  return (
    <section id="cloud-audio-storage" className={shared.card} aria-labelledby="settings-cloud-audio-title">
      <div className={shared.cardHead}>
        <div className={shared.cardHeadMain}>
          <span className={shared.cardIcon}>
            <HardDrive size={18} aria-hidden="true" />
          </span>
          <div className={shared.cardText}>
            <h3 id="settings-cloud-audio-title" className={shared.cardTitle}>Lưu trữ audio trên cloud</h3>
            <p className={shared.cardDescription}>
              Dung lượng kho Blob private chứa audio của các buổi ghi, và các file mồ côi có thể dọn an toàn.
            </p>
          </div>
        </div>
      </div>

      {report && (
        <ul className={styles.stats} aria-busy={working}>
          <li className={styles.stat}>
            <span>Dung lượng kho Blob:</span>
            <span className={styles.statValue}>{formatMegabytes(report.storeTotalBytes)} ({report.storeFiles} file)</span>
          </li>
          <li className={styles.stat}>
            <span>Đang dùng cho buổi ghi:</span>
            <span className={styles.statValue}>{formatMegabytes(report.referencedBytes)}</span>
          </li>
          <li className={styles.stat}>
            <span>Trong Thùng rác:</span>
            <span className={styles.statValue}>{formatMegabytes(report.trashBytes)}</span>
            {report.trashFiles > 0 && (
              <span className={styles.statHint}>Xóa vĩnh viễn trong Thư viện → Thùng rác để giải phóng.</span>
            )}
          </li>
          <li className={styles.stat}>
            <span>Mồ côi (không thuộc buổi nào):</span>
            <span className={styles.statValue}>{formatMegabytes(report.orphanBytes)} ({report.orphanFiles} file)</span>
          </li>
        </ul>
      )}

      {report?.cleanupBlockedReason && <p className={styles.statHint}>{report.cleanupBlockedReason}</p>}

      <div className={shared.actionRow}>
        <button type="button" className={`${shared.btn} ${shared.btnSecondary}`} onClick={() => void check()} disabled={working}>
          {busy === 'loading' ? (
            <>
              <Loader2 size={16} aria-hidden="true" className={shared.spin} />
              <span>Đang kiểm tra…</span>
            </>
          ) : (
            <>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Kiểm tra lại</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnDanger}`}
          onClick={() => void clean()}
          disabled={working || !report || report.orphanFiles === 0 || Boolean(report.cleanupBlockedReason)}
        >
          {busy === 'cleaning' ? (
            <>
              <Loader2 size={16} aria-hidden="true" className={shared.spin} />
              <span>Đang dọn…</span>
            </>
          ) : (
            <>
              <Trash2 size={16} aria-hidden="true" />
              <span>Dọn audio mồ côi</span>
            </>
          )}
        </button>
      </div>

      <div role="status" aria-live="polite" className={styles.statusText}>
        {error && (
          <div className={`${shared.notice} ${shared.noticeError}`}>
            <AlertCircle size={18} aria-hidden="true" />
            <span className={styles.statusText}>{error}</span>
          </div>
        )}
        {!error && result && (
          <div className={`${shared.notice} ${shared.noticeSuccess}`}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <span className={styles.statusText}>{result}</span>
          </div>
        )}
        {busy === 'loading' && !report && !error && (
          <div className={shared.notice}>
            <Loader2 size={18} aria-hidden="true" className={shared.spin} />
            <span className={styles.statusText}>Đang tải dung lượng audio trên cloud…</span>
          </div>
        )}
      </div>

      <p className={shared.hint}>Số trên trang Usage của Vercel là thống kê 30 ngày, có thể giảm chậm sau khi dọn.</p>
    </section>
  );
}
