'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mic } from 'lucide-react';
import { useRecording } from '@/features/recording/recording-context';
import { TranscriptPane } from '@/features/recording/transcript-pane';
import { FloatingRecorderPill } from '@/features/recording/floating-recorder-pill';

function formatSessionTitle(date: Date = new Date()) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `note_${d}/${m} lúc ${hours} giờ ${minutes} phút`;
}

export default function LiveRecordingPage() {
  const router = useRouter();
  const { state, controller } = useRecording();
  const [sessionTitle, setSessionTitle] = useState('');

  const isRecording = state.state === 'recording';

  useEffect(() => {
    if (!sessionTitle) {
      setSessionTitle(formatSessionTitle());
    }
  }, [sessionTitle]);

  // If not recording and session ended, navigate to recordings detail or collections
  useEffect(() => {
    if (!isRecording && state.recordingId && state.state === 'stopped') {
      router.push(`/recordings/${state.recordingId}`);
    }
  }, [isRecording, state.recordingId, state.state, router]);

  const handleBack = (e: React.MouseEvent) => {
    if (isRecording) {
      if (!window.confirm('Buổi ghi âm vẫn đang tiếp tục chạy ngầm. Bạn có muốn quay về Thư viện không?')) {
        e.preventDefault();
        return;
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      {/* Top Header Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <Link
          href="/collections"
          onClick={handleBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: '50%',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            textDecoration: 'none',
          }}
          title="Quay về thư viện"
        >
          <ArrowLeft size={18} />
        </Link>

        <div style={{ flex: 1, textAlign: 'center', padding: '0 16px' }}>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              margin: 0,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            {sessionTitle || 'Buổi ghi âm trực tiếp'}
          </h1>
        </div>

        <div style={{ width: 34 }} />
      </div>

      {/* Central Content Area */}
      <div
        style={{
          maxWidth: 820,
          width: '100%',
          margin: '0 auto',
          padding: '16px 20px 96px 20px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {isRecording || state.captions.length > 0 ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <TranscriptPane
              captions={state.captions}
              speakerCount={state.speakerCount}
              targetLanguage={state.targetLanguage}
              onSpeakerChange={(captionId, label) => controller.setCaptionSpeaker(captionId, label)}
            />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            <Mic size={48} color="var(--accent)" style={{ opacity: 0.5 }} />
            <p style={{ fontSize: '1rem', fontWeight: 500, margin: 0 }}>
              Chưa có phiên ghi âm nào đang chạy.
            </p>
            <Link
              href="/new/source/record"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 24px',
                backgroundColor: 'var(--text-primary)',
                color: 'var(--bg-primary)',
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              Bắt đầu buổi ghi mới
            </Link>
          </div>
        )}
      </div>

      {/* Floating Recorder Pill at the bottom */}
      <FloatingRecorderPill />
    </div>
  );
}
