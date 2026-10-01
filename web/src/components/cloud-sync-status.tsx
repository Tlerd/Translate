'use client';
import { useEffect, useState } from 'react';
import { synchronizeRecordings, syncEvent, type SyncState } from '@/storage/cloud-sync';
export function CloudSyncStatus() {
  const [status, setStatus] = useState<SyncState>({ state: 'syncing', message: 'Đang kiểm tra đồng bộ…' });
  useEffect(() => {
    const update = (event: Event) => setStatus((event as CustomEvent<SyncState>).detail);
    const visible = () => { if (!document.hidden) void synchronizeRecordings(); };
    window.addEventListener(syncEvent, update); window.addEventListener('online', visible); document.addEventListener('visibilitychange', visible);
    void synchronizeRecordings();
    const timer = setInterval(visible, 30000);
    return () => { clearInterval(timer); window.removeEventListener(syncEvent, update); window.removeEventListener('online', visible); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return <button type="button" onClick={() => void synchronizeRecordings()} title={status.message} style={{ fontSize: 11, color: status.state === 'error' ? 'var(--warning)' : 'var(--text-secondary)', padding: 6, maxWidth: 160, textAlign: 'left' }} aria-label={`Đồng bộ: ${status.message}`}>{status.message}</button>;
}
