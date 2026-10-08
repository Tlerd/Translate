'use client';

import React, { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft, Square, Radio, Plus } from 'lucide-react';
import styles from './app-shell.module.css';
import { LibraryNav } from '@/features/library/library-nav';
import { useRecording } from '@/features/recording/recording-context';
import { MobileBottomNav, isBottomNavHidden } from './mobile-nav';
import { SidebarProvider } from './sidebar-context';

export function AppShell({ children }: { children: React.ReactNode; accountControls?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { state: recordingState, stopRecording } = useRecording();
  const pathname = usePathname();
  const isRecording = recordingState.state === 'recording';
  const isRecordingDetail = /^\/recordings\/[^/]+/.test(pathname);
  const sidebarValue = useMemo(
    () => ({ sidebarOpen, setSidebarOpen, toggleSidebar: () => setSidebarOpen(open => !open) }),
    [sidebarOpen],
  );
  // The drawer reserves room for the bottom nav only when the nav is actually shown.
  const bottomNavHidden = isBottomNavHidden(pathname);

  // Tabs close the mobile drawer; the desktop sidebar stays put.
  const closeDrawerOnMobile = () => {
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

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

  // Entering a saved recording on desktop collapses the sidebar once; the detail header's toggle reopens it.
  const prevRecordingDetailRef = useRef(false);
  useEffect(() => {
    const entered = isRecordingDetail && !prevRecordingDetailRef.current;
    prevRecordingDetailRef.current = isRecordingDetail;
    if (entered && window.innerWidth > 768) {
      setSidebarOpen(false);
    }
  }, [isRecordingDetail]);

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
      // A live session keeps the top bar so its Dừng button stays reachable from any page.
      data-recording-detail={isRecordingDetail && !isRecording ? 'true' : 'false'}
      data-bottom-nav={bottomNavHidden ? 'hidden' : 'shown'}
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
        {/* LibraryNav reads the URL (useSearchParams), so it needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <LibraryNav
            onCloseMobile={() => {
              // Only the mobile drawer closes after picking a collection; the desktop sidebar stays put.
              if (window.innerWidth <= 768) setSidebarOpen(false);
            }}
            onToggleSidebar={() => setSidebarOpen(v => !v)}
          />
        </Suspense>
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
            <Link href="/library" className={styles.appTitle} title="Máy Dịch" aria-label="Máy Dịch">
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

        <main className={styles.contentBody}>
          <SidebarProvider value={sidebarValue}>{children}</SidebarProvider>
        </main>

        {/* Mobile Bottom Navigation. It reads the URL (useSearchParams), so it needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <MobileBottomNav
            onOpenFolders={() => setSidebarOpen(true)}
            onNavigate={closeDrawerOnMobile}
          />
        </Suspense>
      </div>
    </div>
  );
}
