'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Plus, Settings } from 'lucide-react';
import styles from './mobile-nav.module.css';

export function MobileBottomNav() {
  const pathname = usePathname();

  // Hide global mobile bottom nav on recording detail and live recording pages
  if (pathname.startsWith('/recordings/') || pathname === '/recording') {
    return null;
  }

  const isCollections = pathname === '/collections' || pathname === '/library';
  const isSettings = pathname === '/settings' || pathname === '/usage';

  return (
    <nav className={styles.bottomNav} aria-label="Điều hướng di động">
      <Link
        href="/collections"
        className={`${styles.navItem} ${isCollections ? styles.active : ''}`}
        title="Thư viện"
      >
        <BookOpen size={20} />
        <span className={styles.label}>Thư viện</span>
      </Link>

      <Link
        href="/new/source/record"
        className={styles.addBtnWrapper}
        title="Thêm mới"
        aria-label="Thêm mới"
      >
        <div className={styles.addBtn}>
          <Plus size={22} color="currentColor" />
        </div>
      </Link>

      <Link
        href="/settings"
        className={`${styles.navItem} ${isSettings ? styles.active : ''}`}
        title="Cài đặt"
      >
        <Settings size={20} />
        <span className={styles.label}>Cài đặt</span>
      </Link>
    </nav>
  );
}
