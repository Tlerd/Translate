'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Cloud,
  Cpu,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { AiSettings } from '@/features/settings/ai-settings';
import { TranslationConnectionTest } from '@/features/settings/translation-connection-test';
import { SpeechConnectionTest } from '@/features/settings/speech-connection-test';
import { useSettingsSections } from '@/features/settings/use-settings-sections';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAccount } from '@/components/account-context';
import shared from '@/features/settings/settings-shared.module.css';
import styles from './settings.module.css';

interface SettingsGroupLink {
  id: string;
  label: string;
  icon: LucideIcon;
}

const GROUPS: readonly SettingsGroupLink[] = [
  { id: 'appearance-account', label: 'Chung', icon: SunMoon },
  { id: 'ai-config', label: 'Mô hình AI', icon: Cpu },
  { id: 'connection-tests', label: 'Kiểm tra kết nối', icon: Activity },
  { id: 'usage-cost', label: 'Chi phí', icon: BarChart3 },
];

const GROUP_IDS = GROUPS.map((group) => group.id);

export default function SettingsPage() {
  const { accountControls } = useAccount();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { activeId, scrollToSection } = useSettingsSections(scrollRef, GROUP_IDS);

  // On phones the tab bar scrolls sideways, so keep the active tab in view. Only the tab list
  // moves: scrollIntoView would also scroll the page and cancel a smooth scroll in progress.
  useEffect(() => {
    const link = document.getElementById(`settings-nav-${activeId}`);
    const list = link?.closest('ul');
    if (!link || !list || list.scrollWidth <= list.clientWidth) return;
    const linkBox = link.getBoundingClientRect();
    const left = linkBox.left - list.getBoundingClientRect().left + list.scrollLeft - (list.clientWidth - linkBox.width) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }, [activeId]);

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div className={styles.layout}>
        <header className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <h1 className={styles.pageTitle}>Cài đặt</h1>
            <p className={styles.pageSubtitle}>Giao diện, mô hình AI, kiểm tra kết nối và chi phí dịch.</p>
          </div>
          <Link href="/library" className={`${shared.btn} ${shared.btnSecondary}`}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Về phòng học</span>
          </Link>
        </header>

        <nav className={styles.nav} aria-label="Các mục cài đặt">
          <ul className={styles.navList}>
            {GROUPS.map(({ id, label, icon: Icon }) => {
              const isActive = id === activeId;
              return (
                <li key={id} className={styles.navItem}>
                  <a
                    id={`settings-nav-${id}`}
                    href={`#${id}`}
                    className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      scrollToSection(id);
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.content}>
          <section id="appearance-account" className={styles.group} aria-labelledby="settings-group-general">
            <div className={styles.groupHeader}>
              <h2 id="settings-group-general" className={styles.groupTitle}>Chung</h2>
              <p className={styles.groupDescription}>Giao diện hiển thị, tài khoản đăng nhập và đồng bộ dữ liệu.</p>
            </div>
            <div className={styles.groupBody}>
              <section className={shared.card} aria-labelledby="settings-appearance-title">
                <div className={shared.cardHead}>
                  <div className={shared.cardHeadMain}>
                    <span className={shared.cardIcon}>
                      <SunMoon size={18} aria-hidden="true" />
                    </span>
                    <div className={shared.cardText}>
                      <h3 id="settings-appearance-title" className={shared.cardTitle}>Giao diện</h3>
                      <p className={shared.cardDescription}>Chuyển giữa giao diện sáng và tối.</p>
                    </div>
                  </div>
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Chế độ Sáng / Tối</span>
                  <ThemeToggle />
                </div>
              </section>

              <section className={shared.card} aria-labelledby="settings-account-title">
                <div className={shared.cardHead}>
                  <div className={shared.cardHeadMain}>
                    <span className={shared.cardIcon}>
                      <Cloud size={18} aria-hidden="true" />
                    </span>
                    <div className={shared.cardText}>
                      <h3 id="settings-account-title" className={shared.cardTitle}>Tài khoản &amp; đồng bộ</h3>
                      <p className={shared.cardDescription}>Phiên làm việc và đồng bộ dữ liệu lên đám mây.</p>
                    </div>
                  </div>
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Phiên làm việc</span>
                  <div className={styles.accountSlot}>
                    {accountControls || <span className={styles.accountEmpty}>Chưa đăng nhập</span>}
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section id="ai-config" className={styles.group} aria-labelledby="settings-group-ai">
            <div className={styles.groupHeader}>
              <h2 id="settings-group-ai" className={styles.groupTitle}>Mô hình AI</h2>
              <p className={styles.groupDescription}>
                Bộ nhận diện giọng nói, ngôn ngữ mặc định, khoảng nghỉ chốt câu và model tóm tắt.
              </p>
            </div>
            <AiSettings />
          </section>

          <section id="connection-tests" className={styles.group} aria-labelledby="settings-group-connection">
            <div className={styles.groupHeader}>
              <h2 id="settings-group-connection" className={styles.groupTitle}>Kiểm tra kết nối</h2>
              <p className={styles.groupDescription}>
                Thử dịch và nhận giọng để xác nhận khóa API và quyền dùng model trước khi bắt đầu buổi học.
              </p>
            </div>
            <div className={styles.groupBody}>
              <TranslationConnectionTest />
              <SpeechConnectionTest />
            </div>
          </section>

          <section id="usage-cost" className={styles.group} aria-labelledby="settings-group-usage">
            <div className={styles.groupHeader}>
              <h2 id="settings-group-usage" className={styles.groupTitle}>Chi phí</h2>
              <p className={styles.groupDescription}>Theo dõi số request và token đã ghi nhận cho các lượt dịch.</p>
            </div>
            <div className={styles.groupBody}>
              <section className={shared.card} aria-labelledby="settings-usage-title">
                <div className={shared.cardHead}>
                  <div className={shared.cardHeadMain}>
                    <span className={shared.cardIcon}>
                      <BarChart3 size={18} aria-hidden="true" />
                    </span>
                    <div className={shared.cardText}>
                      <h3 id="settings-usage-title" className={shared.cardTitle}>Chi phí dịch &amp; token</h3>
                      <p className={shared.cardDescription}>
                        Xem input, output và thinking token đã ghi nhận, kèm số request theo từng ngày.
                      </p>
                    </div>
                  </div>
                </div>
                <Link href="/usage" className={`${shared.btn} ${shared.btnPrimary} ${styles.usageLink}`}>
                  <span>Xem chi phí dịch</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
