'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Mic } from 'lucide-react';
import { useRecording } from '@/features/recording/recording-context';
import { TranscriptPane } from '@/features/recording/transcript-pane';
import { FloatingRecorderPill } from '@/features/recording/floating-recorder-pill';
import { languageName } from '@/shared/languages';
import { speechProviderName } from '@/shared/transcription';
import styles from './live-room.module.css';

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

  const paused = state.apiState === 'paused' || state.apiState === 'pausing';
  const noTextYet = isRecording && !paused && state.transcriptCount === 0;
  const maybeSilent = noTextYet && state.receivedAudioMs > 8000;
  const status = !isRecording
    ? null
    : state.error
      ? { tone: 'error', label: 'Có lỗi' }
      : paused
        ? { tone: 'paused', label: 'Tạm dừng nhận giọng' }
        : state.speechState === 'listening'
          ? { tone: 'live', label: 'Đang nghe' }
          : { tone: 'wait', label: 'Đang kết nối…' };
  const pair = `${state.sourceLanguage === 'auto' ? 'Tự nhận biết' : languageName(state.sourceLanguage)} → ${state.targetLanguage === 'none' ? 'Không dịch' : languageName(state.targetLanguage)}`;

  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <Link href="/collections" onClick={handleBack} className={styles.backBtn} title="Quay về thư viện" aria-label="Quay về thư viện">
          <ArrowLeft size={18} />
        </Link>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{sessionTitle || 'Buổi ghi âm trực tiếp'}</h1>
          {isRecording && <p className={styles.subtitle}>{speechProviderName(state.speechProvider)} · {pair}</p>}
        </div>
        {status ? (
          <span className={`${styles.status} ${styles[status.tone]}`} role="status">
            <span className={styles.statusDot} aria-hidden />
            {status.label}
          </span>
        ) : <span className={styles.statusSpacer} />}
      </header>

      {isRecording && state.error && (
        <div role="alert" className={styles.alert}>
          <AlertTriangle size={16} aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

      <div className={styles.body}>
        {isRecording || state.captions.length > 0 ? (
          <>
            {state.captions.length === 0 ? (
              <div className={styles.listening} aria-live="polite">
                <div className={`${styles.bars} ${paused ? styles.barsIdle : ''}`} aria-hidden>
                  <span /><span /><span /><span /><span />
                </div>
                <p className={styles.listeningTitle}>{paused ? 'Đang tạm dừng nhận giọng' : 'Đang lắng nghe…'}</p>
                <p className={styles.listeningHint}>
                  {paused
                    ? 'Âm thanh vẫn được ghi. Bấm Tiếp tục để nhận giọng và dịch lại.'
                    : 'Hãy bắt đầu nói. Chữ gốc sẽ hiện ngay khi bộ nhận giọng nghe được.'}
                </p>
                {maybeSilent && (
                  <div className={styles.tip} role="note">
                    <strong>Chưa nhận được chữ sau {Math.floor(state.receivedAudioMs / 1000)} giây.</strong>
                    <span>
                      Nói gần micro hơn, kiểm tra micro đang dùng{state.micDeviceLabel ? ` (${state.micDeviceLabel})` : ''} và âm lượng đầu vào của thiết bị.
                      Nếu vẫn không có chữ, thử đổi sang Gemini 3.5 Transcribe trong Cấu hình AI.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <TranscriptPane
                captions={state.captions}
                speakerCount={state.speakerCount}
                targetLanguage={state.targetLanguage}
                onSpeakerChange={(captionId, label) => controller.setCaptionSpeaker(captionId, label)}
              />
            )}
          </>
        ) : (
          <div className={styles.empty}>
            <Mic size={48} color="var(--accent)" style={{ opacity: 0.5 }} />
            <p className={styles.emptyTitle}>Chưa có phiên ghi âm nào đang chạy.</p>
            <Link href="/new/source/record" className={styles.cta}>Bắt đầu buổi ghi mới</Link>
          </div>
        )}
      </div>

      <FloatingRecorderPill />
    </div>
  );
}
