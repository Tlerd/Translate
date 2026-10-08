'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mic, Youtube, FileText, Globe, FileAudio, BookOpen, Loader2 } from 'lucide-react';
import { useRecording } from '@/features/recording/recording-context';
import styles from './record-source.module.css';

export default function RecordSourcePage() {
  const router = useRouter();
  const { state, startRecording } = useRecording();
  const [contextText, setContextText] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [activeTab, setActiveTab] = useState<'record' | 'youtube' | 'pdf' | 'web' | 'file' | 'book'>('record');

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      if (contextText.trim()) {
        try {
          sessionStorage.setItem('recording_pre_context', contextText.trim());
        } catch {
          // ignore
        }
      }
      await startRecording({
        speechProvider: state.speechProvider,
        transcriptionMode: state.transcriptionMode,
        speakerCount: state.speakerCount,
        mode: state.mode,
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        translationModelKey: state.translationModelKey,
        pauseMs: state.pauseMs,
        readingPauseMs: state.readingPauseMs,
      });
      router.push('/recording');
    } catch (err) {
      console.error('Lỗi khởi động ghi âm:', err);
      alert(err instanceof Error ? err.message : String(err));
      setIsStarting(false);
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', backgroundColor: 'var(--bg-primary)' }}>
      <div className={styles.container}>
        {/* Top Back Row */}
        <div className={styles.topRow}>
          <Link href="/collections" className={styles.backBtn} title="Quay lại Thư viện">
            <ArrowLeft size={16} />
            <span>Quay lại</span>
          </Link>
        </div>

        {/* Centered Title */}
        <h1 className={styles.pageTitle}>Nhập nguồn</h1>

        {/* Source Switch Tabs */}
        <div className={styles.tabsContainer} role="tablist" aria-label="Chọn nguồn tài liệu">
          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'youtube' ? styles.sourceTabActive : ''}`}
            onClick={() => {
              setActiveTab('youtube');
              alert('Tính năng nhập từ YouTube đang được phát triển.');
              setActiveTab('record');
            }}
          >
            <Youtube size={15} color="#ef4444" />
            <span>YouTube</span>
          </button>

          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'pdf' ? styles.sourceTabActive : ''}`}
            onClick={() => {
              setActiveTab('pdf');
              alert('Tính năng nhập từ PDF đang được phát triển.');
              setActiveTab('record');
            }}
          >
            <FileText size={15} color="#f59e0b" />
            <span>PDF</span>
          </button>

          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'web' ? styles.sourceTabActive : ''}`}
            onClick={() => {
              setActiveTab('web');
              alert('Tính năng nhập từ Trang web đang được phát triển.');
              setActiveTab('record');
            }}
          >
            <Globe size={15} color="#8b5cf6" />
            <span>Trang web</span>
          </button>

          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'file' ? styles.sourceTabActive : ''}`}
            onClick={() => {
              setActiveTab('file');
              router.push('/app?action=upload');
            }}
          >
            <FileAudio size={15} color="#10b981" />
            <span>Tệp video / âm thanh</span>
          </button>

          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'record' ? styles.sourceTabActive : ''}`}
            onClick={() => setActiveTab('record')}
          >
            <Mic size={15} />
            <span>Ghi âm trực tiếp</span>
          </button>

          <button
            type="button"
            className={`${styles.sourceTab} ${activeTab === 'book' ? styles.sourceTabActive : ''}`}
            onClick={() => {
              setActiveTab('book');
              alert('Tính năng nhập từ Sách đang được thử nghiệm Beta.');
              setActiveTab('record');
            }}
          >
            <BookOpen size={15} color="#38bdf8" />
            <span>Sách</span>
            <span className={styles.badgeBeta}>Beta</span>
          </button>
        </div>

        {/* Context Input Section */}
        <div className={styles.sectionBox}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Nhập ngữ cảnh giúp ghi âm chính xác hơn!</h2>
            <p className={styles.sectionDesc}>
              Bạn có thể nhập tối đa 10.000 ký tự về thuật ngữ chuyên ngành hoặc tài liệu liên quan.
            </p>
          </div>

          <div className={styles.textareaWrapper}>
            <textarea
              className={styles.contextInput}
              placeholder="Nhập văn bản thuật ngữ, nội dung bài giảng hoặc bối cảnh cần hỗ trợ dịch..."
              maxLength={10000}
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              disabled={isStarting}
            />
            <span className={styles.charCounter}>{contextText.length} / 10000</span>
          </div>
        </div>

        {/* Recording Quota & Diagnostic Information Card */}
        <div className={styles.quotaCard}>
          <div className={styles.quotaHeader}>Hãy kiểm tra xem bạn còn đủ thời gian ghi âm không!</div>
          <div className={styles.quotaNotice}>Nếu hết thời gian trong khi ghi âm, quá trình có thể bị gián đoạn.</div>
          <div className={styles.quotaStats}>
            <span>Thời gian ghi âm còn lại:</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Không giới hạn (Lưu thiết bị)</span>
          </div>
        </div>

        {/* Primary Start Button */}
        <div className={styles.startBtnWrapper}>
          <button
            type="button"
            className={styles.startBtn}
            onClick={handleStart}
            disabled={isStarting}
          >
            {isStarting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Đang khởi động…</span>
              </>
            ) : (
              <span>Bắt đầu</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
