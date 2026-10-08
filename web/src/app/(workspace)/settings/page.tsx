'use client';

import React from 'react';
import Link from 'next/link';
import { AiSettings } from '@/features/settings/ai-settings';
import { TranslationConnectionTest } from '@/features/settings/translation-connection-test';
import { SpeechConnectionTest } from '@/features/settings/speech-connection-test';
import { Settings, Zap, Mic, BarChart3, SunMoon } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAccount } from '@/components/account-context';

export default function SettingsPage() {
  const { accountControls } = useAccount();

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        scrollBehavior: 'smooth',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      {/* Quick Navigation Anchor Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: 'var(--bg-glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '10px 20px',
        }}
      >
        <div
          style={{
            maxWidth: 860,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          <a
            href="#appearance-account"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <SunMoon size={14} color="var(--accent)" />
            <span>Giao diện & Tài khoản</span>
          </a>

          <a
            href="#ai-config"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <Settings size={14} color="var(--accent)" />
            <span>Cấu hình AI</span>
          </a>

          <a
            href="#translation-test"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <Zap size={14} color="var(--accent)" />
            <span>Thử nghiệm Dịch</span>
          </a>

          <a
            href="#speech-test"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <Mic size={14} color="var(--accent)" />
            <span>Kiểm tra Nhận giọng</span>
          </a>

          <Link
            href="/usage"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <BarChart3 size={14} color="var(--accent)" />
            <span>Chi phí dịch</span>
          </Link>
        </div>
      </div>

      {/* Appearance & Account Section */}
      <section
        id="appearance-account"
        style={{
          maxWidth: 860,
          margin: '0 auto',
          padding: '24px 20px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            padding: '20px 22px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SunMoon size={18} color="var(--accent)" />
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Giao diện & Tài khoản
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tùy chỉnh giao diện hiển thị sáng/tối và quản lý tài khoản đăng nhập, đồng bộ dữ liệu
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            {/* Theme toggle card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Chế độ Sáng / Tối
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Chuyển đổi giao diện Sáng hoặc Tối
                </div>
              </div>
              <ThemeToggle />
            </div>

            {/* Account controls card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Tài khoản & Đăng xuất
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Phiên làm việc và đồng bộ đám mây
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {accountControls || (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Chưa đăng nhập
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Settings Sections */}
      <AiSettings />
      <TranslationConnectionTest />
      <SpeechConnectionTest />
    </div>
  );
}
