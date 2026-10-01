'use client';

import React, { useEffect, useState } from 'react';
import styles from './theme-toggle.module.css';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const currentTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | null;
    if (currentTheme) {
      setTheme(currentTheme);
    } else {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
      if (saved) {
        setTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        const initial = prefersLight ? 'light' : 'dark';
        setTheme(initial);
        document.documentElement.setAttribute('data-theme', initial);
      }
    }
  }, []);

  const handleToggle = (checked: boolean) => {
    // checked = true means dark mode, false means light mode
    const nextTheme: 'dark' | 'light' = checked ? 'dark' : 'light';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    try {
      localStorage.setItem('theme', nextTheme);
    } catch {
      // localStorage may fail in private mode
    }
  };

  if (!mounted) {
    return (
      <div className={styles.toggleWrapper} aria-hidden="true">
        <label className={styles.switch}>
          <span className={styles.slider} />
        </label>
      </div>
    );
  }

  const isDark = theme === 'dark';

  return (
    <div className={styles.toggleWrapper}>
      <label
        className={styles.switch}
        title={isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
        aria-label="Chuyển chế độ sáng và tối"
      >
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={isDark}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span className={styles.slider} />
      </label>
    </div>
  );
}
