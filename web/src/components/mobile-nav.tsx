'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BookOpen, Folder, Plus, Search, Settings } from 'lucide-react';
import styles from './mobile-nav.module.css';

export interface MobileBottomNavProps {
  /** Opens the sidebar drawer (the Thư mục tab). */
  onOpenFolders: () => void;
  /** Runs when a tab navigates, so an open drawer closes even when the page does not change. */
  onNavigate?: () => void;
}

// Legacy paths (/collections, /trash, /app) still belong to the library section.
const LIBRARY_PATHS: readonly string[] = ['/library', '/collections', '/trash', '/app'];

/** The bottom nav is hidden on recording detail and live recording pages. */
export function isBottomNavHidden(pathname: string): boolean {
  return pathname.startsWith('/recordings/') || pathname === '/recording';
}

export function MobileBottomNav({ onOpenFolders, onNavigate }: MobileBottomNavProps) {
  const pathname = usePathname();
  // useSearchParams needs a Suspense boundary above this component (see AppShell).
  const searchParams = useSearchParams();

  if (isBottomNavHidden(pathname)) {
    return null;
  }

  // The search tab opens the library with focus=search; that is not the library tab's active state.
  const isSearchTab = searchParams.get('focus') === 'search';
  const isLibrary = LIBRARY_PATHS.includes(pathname) && !isSearchTab;
  const isSettings = pathname === '/settings' || pathname === '/usage';

  return (
    <nav className={styles.bottomNav} aria-label="Điều hướng di động">
      <Link
        href="/library"
        className={`${styles.navItem} ${isLibrary ? styles.active : ''}`}
        title="Thư viện"
        aria-label="Thư viện"
        aria-current={isLibrary ? 'page' : undefined}
        onClick={onNavigate}
      >
        <BookOpen size={20} aria-hidden="true" />
        <span className={styles.label}>Thư viện</span>
      </Link>

      <button
        type="button"
        className={styles.navItem}
        title="Thư mục"
        aria-label="Thư mục"
        aria-controls="recording-library"
        onClick={onOpenFolders}
      >
        <Folder size={20} aria-hidden="true" />
        <span className={styles.label}>Thư mục</span>
      </button>

      <Link
        href="/new/source/record"
        className={styles.addBtnWrapper}
        title="Thêm mới"
        aria-label="Thêm mới"
      >
        <div className={styles.addBtn} aria-hidden="true">
          <Plus size={22} color="currentColor" />
        </div>
      </Link>

      <Link
        href="/library?focus=search"
        className={styles.navItem}
        title="Tìm"
        aria-label="Tìm"
        onClick={onNavigate}
      >
        <Search size={20} aria-hidden="true" />
        <span className={styles.label}>Tìm</span>
      </Link>

      <Link
        href="/settings"
        className={`${styles.navItem} ${isSettings ? styles.active : ''}`}
        title="Cài đặt"
        aria-label="Cài đặt"
        aria-current={isSettings ? 'page' : undefined}
        onClick={onNavigate}
      >
        <Settings size={20} aria-hidden="true" />
        <span className={styles.label}>Cài đặt</span>
      </Link>
    </nav>
  );
}
