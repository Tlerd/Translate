'use client';

import React from 'react';
import Link from 'next/link';
import { AiSettings } from '@/features/settings/ai-settings';
import { TranslationConnectionTest } from '@/features/settings/translation-connection-test';
import { SpeechConnectionTest } from '@/features/settings/speech-connection-test';
import { Settings, Zap, Mic, BarChart3 } from 'lucide-react';

export default function SettingsPage() {
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

      {/* Main Settings Sections */}
      <AiSettings />
      <TranslationConnectionTest />
      <SpeechConnectionTest />
    </div>
  );
}
