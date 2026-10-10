'use client';

import React, { useEffect, useState } from 'react';
import { Cloud, RefreshCw, CloudOff } from 'lucide-react';
import { synchronizeRecordings, syncEvent, type SyncState } from '@/storage/cloud-sync';
import styles from './cloud-sync-status.module.css';
import { audioWorkEvent } from '@/shared/audio';

export function CloudSyncStatus() {
  const [status, setStatus] = useState<SyncState>({ state: 'syncing', message: 'Đang kiểm tra đồng bộ…' });
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const update = (event: Event) => {
      setStatus((event as CustomEvent<SyncState>).detail);
      setIsManualSyncing(false);
    };
    const visible = () => {
      if (!document.hidden) void synchronizeRecordings();
    };

    window.addEventListener(syncEvent, update);
    const audioReady = () => { void synchronizeRecordings(); };
    const online = () => { void synchronizeRecordings(true); };
    window.addEventListener(audioWorkEvent, audioReady);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);

    void synchronizeRecordings();
    const timer = setInterval(visible, 30000);

    return () => {
      clearInterval(timer);
      window.removeEventListener(syncEvent, update);
      window.removeEventListener(audioWorkEvent, audioReady);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const handleSyncClick = async () => {
    setIsManualSyncing(true);
    try {
      await synchronizeRecordings(true);
    } finally {
      setIsManualSyncing(false);
    }
  };

  const isSyncing = status.state === 'syncing' || isManualSyncing;
  const isError = status.state === 'error';

  const getLabel = () => {
    if (isSyncing) return status.phase === 'audio' ? 'Audio đang tải…' : 'Đang đồng bộ chữ…';
    if (isError) return status.phase === 'audio' ? 'Chữ đã đồng bộ · audio lỗi' : 'Lỗi đồng bộ chữ';
    return 'Đã đồng bộ';
  };

  return (
    <button
      type="button"
      onClick={() => void handleSyncClick()}
      className={styles.syncButton}
      title={status.message}
      aria-label={`Đồng bộ: ${status.message}`}
    >
      <div className={styles.iconWrapper}>
        {isSyncing ? (
          <RefreshCw size={15} className={styles.spinning} />
        ) : isError ? (
          <CloudOff size={15} className={styles.errorIcon} />
        ) : (
          <Cloud size={15} />
        )}
        <span
          className={`${styles.statusDot} ${
            isSyncing
              ? styles.dotSyncing
              : isError
              ? styles.dotError
              : styles.dotDone
          }`}
        />
      </div>
      <span className={styles.syncText}>{getLabel()}</span>
    </button>
  );
}
