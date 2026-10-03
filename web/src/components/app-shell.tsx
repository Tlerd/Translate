'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Square, Settings, Radio } from 'lucide-react';
import styles from './app-shell.module.css';
import { LibrarySidebar } from '@/features/library/library-sidebar';
import { useRecording } from '@/features/recording/recording-context';
import { ThemeToggle } from './theme-toggle';

export function AppShell({ children, accountControls }: { children: React.ReactNode; accountControls?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state: recordingState, stopRecording } = useRecording();
  const pathname = usePathname();

  // Close mobile sidebar upon navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

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
        id="recording-library"
        className={`${styles.sidebarWrapper} ${sidebarOpen ? styles.sidebarOpen : ''}`}
      >
        <LibrarySidebar onCloseMobile={() => setSidebarOpen(false)} />
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              className={`${styles.toggleButton} ${styles.menuButton}`}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Mở/Đóng danh sách bản ghi"
              aria-label={sidebarOpen ? 'Đóng danh sách bản ghi' : 'Mở danh sách bản ghi'}
              aria-expanded={sidebarOpen}
              aria-controls="recording-library"
            >
              {sidebarOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
            <Link href="/app" className={styles.appTitle} title="Máy Dịch Lớp Học" aria-label="Máy Dịch Lớp Học">
              <span className={styles.appLogo}>
                <Radio size={18} color="var(--accent)" />
              </span>
              <span className={styles.appTitleText}>Máy Dịch Lớp Học</span>
            </Link>
          </div>

          <div className={styles.topBarRight}>
            {/* Active recording persistent status banner */}
            {isRecording && (
              <div className={styles.activeSessionBanner}>
                <div className={styles.recordingDot} />
                <span className={styles.recordingText}>Đang thu ({formatDuration(recordingState.durationMs)})</span>
                <button
                  onClick={() => stopRecording()}
                  className={styles.stopButton}
                  title="Kết thúc buổi học"
                >
                  <Square size={10} fill="#fff" />
                  <span>Dừng</span>
                </button>
              </div>
            )}

            {accountControls && (
              <div className={styles.accountWrapper}>
                {accountControls}
              </div>
            )}

            <ThemeToggle />

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
