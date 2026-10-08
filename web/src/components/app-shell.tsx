'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft, Square, Radio, Plus } from 'lucide-react';
import styles from './app-shell.module.css';
import { LibrarySidebar } from '@/features/library/library-sidebar';
import { useRecording } from '@/features/recording/recording-context';
import { MobileBottomNav } from './mobile-nav';

export function AppShell({ children }: { children: React.ReactNode; accountControls?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { state: recordingState, stopRecording } = useRecording();
  const pathname = usePathname();
  const isRecording = recordingState.state === 'recording';
  const isRecordingDetail = pathname.startsWith('/recordings/');

  // On initial mount on small screens, collapse sidebar
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, []);

  // Close mobile sidebar upon navigation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [pathname]);

  // Auto-collapse sidebar when recording starts to enter LilysAI focus mode
  const prevRecordingRef = useRef(isRecording);
  useEffect(() => {
    if (!prevRecordingRef.current && isRecording) {
      setSidebarOpen(false);
    }
    prevRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={styles.shell}
      data-sidebar-open={sidebarOpen ? 'true' : 'false'}
      data-recording-detail={isRecordingDetail ? 'true' : 'false'}
    >
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
        className={`${styles.sidebarWrapper} ${sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed}`}
      >
        <LibrarySidebar
          onCloseMobile={() => setSidebarOpen(false)}
          onToggleSidebar={() => setSidebarOpen(v => !v)}
        />
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            {/* Show toggle button in TopBar ONLY when sidebar is closed (LilysAI standard) */}
            {!sidebarOpen && (
              <button
                className={`${styles.toggleButton} ${styles.menuButton}`}
                onClick={() => setSidebarOpen(true)}
                title="Mở thanh bên"
                aria-label="Mở thanh bên"
                aria-expanded={false}
                aria-controls="recording-library"
              >
                <PanelLeft size={18} />
              </button>
            )}
            <Link href="/app" className={styles.appTitle} title="Máy Dịch" aria-label="Máy Dịch">
              <span className={styles.appLogo}>
                <Radio size={18} color="var(--accent)" />
              </span>
              <span className={styles.appTitleText}>Máy Dịch</span>
            </Link>
          </div>

          <div className={styles.topBarRight}>
            {/* LilysAI style + Thêm mới button on TopBar */}
            <Link
              href="/new/source/record"
              className={styles.topBarNewBtn}
              title="Bắt đầu buổi ghi mới"
            >
              <Plus size={14} />
              <span>Thêm mới</span>
            </Link>

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
          </div>
        </header>

        <main className={styles.contentBody}>{children}</main>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNav />
      </div>
    </div>
  );
}
