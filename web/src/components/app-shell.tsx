'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Square, Settings, Radio } from 'lucide-react';
import styles from './app-shell.module.css';
import { LibrarySidebar } from '@/features/library/library-sidebar';
import { useRecording } from '@/features/recording/recording-context';

export function AppShell({ children, accountControls }: { children: React.ReactNode; accountControls?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state: recordingState, stopRecording } = useRecording();
  const pathname = usePathname();

  // Close mobile sidebar upon navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const isRecording = recordingState.state === 'recording';

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={styles.shell}>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setSidebarOpen(false)}
          aria-label="Đóng thanh bên"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${styles.sidebarWrapper} ${sidebarOpen ? styles.sidebarOpen : ''}`}
      >
        <LibrarySidebar onCloseMobile={() => setSidebarOpen(false)} />
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              className={styles.toggleButton}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Mở/Đóng danh sách bản ghi"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <Link href="/app" className={styles.appTitle}>
              <Radio size={20} color="#38bdf8" />
              <span>Máy Dịch Lớp Học</span>
            </Link>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {accountControls}
            {/* Active recording persistent status banner */}
            {isRecording && (
              <div className={styles.activeSessionBanner}>
                <div className={styles.recordingDot} />
                <span>Đang thu ({formatDuration(recordingState.durationMs)})</span>
                <button
                  onClick={() => stopRecording()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    backgroundColor: 'var(--danger)',
                    color: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                  title="Kết thúc buổi học"
                >
                  <Square size={12} fill="#fff" />
                  <span>Dừng</span>
                </button>
              </div>
            )}

            <Link
              href="/settings"
              className={styles.toggleButton}
              title="Cấu hình AI"
            >
              <Settings size={18} />
            </Link>
          </div>
        </header>

        <main className={styles.contentBody}>{children}</main>
      </div>
    </div>
  );
}
