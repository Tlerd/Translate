'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, AudioLines, Plus } from 'lucide-react';
import { listRecordings } from '@/storage/recordings';
import { dataEvent } from '@/storage/cloud-sync';
import type { RecordingItem } from '@/shared/recording';
import styles from './home-dashboard.module.css';

function formatDisplayDate(iso: string) {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return iso;
  }
}

export default function HomePage() {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    try {
      const items = await listRecordings(10, 0, false);
      setRecordings(items);
    } catch (err) {
      console.error('Lỗi tải danh sách bản ghi:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    const reload = () => { void loadRecent(); };
    window.addEventListener(dataEvent, reload);
    return () => window.removeEventListener(dataEvent, reload);
  }, [loadRecent]);

  return (
    <div className={styles.dashboard}>
      {/* Top Banner Message */}
      <div className={styles.bannerRow}>
        <p className={styles.bannerText}>
          Chỉ cần lưu và ghi âm. Không bỏ lỡ bất kỳ insight nào.
        </p>
      </div>

      {/* Section Thư viện */}
      <section className={styles.section} aria-label="Thư viện bản ghi">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleGroup}>
            <BookOpen size={20} color="var(--accent)" />
            <h2 className={styles.sectionTitle}>Thư viện</h2>
          </div>
          <Link href="/collections" className={styles.viewAllLink} title="Xem toàn bộ thư viện">
            <span>Xem tất cả</span>
            <ArrowRight size={15} />
          </Link>
        </div>

        {/* Dynamic 4 / 5 Columns Grid */}
        <div className={styles.libraryGrid}>
          {recordings.slice(0, 5).map((rec) => (
            <Link
              key={rec.id}
              href={`/recordings/${rec.id}`}
              className={styles.card}
              title={rec.title}
            >
              <div className={styles.cardThumbnail}>
                <span className={styles.cardBrandLogo}>Máy Dịch</span>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardAudioMeta}>
                  <AudioLines size={13} color="var(--accent)" />
                  <span>Ghi âm</span>
                </div>
                <h3 className={styles.cardTitle}>{rec.title}</h3>
                <span className={styles.cardDate}>{formatDisplayDate(rec.createdAt)}</span>
              </div>
            </Link>
          ))}

          {/* Plus / New card if fewer than 5 recordings */}
          {recordings.length < 5 && (
            <Link
              href="/new/source/record"
              className={`${styles.card} ${styles.newCard}`}
              title="Tạo buổi ghi mới"
            >
              <Plus size={28} />
              <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Thêm mới</span>
            </Link>
          )}

          {!loading && recordings.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              Chưa có bản ghi nào. Bấm <strong>Thêm mới</strong> để bắt đầu phiên dịch đầu tiên của bạn!
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
