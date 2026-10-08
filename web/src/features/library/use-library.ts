'use client';

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { dataEvent } from '@/storage/cloud-sync';
import { loadLibraryEntries } from './library-data';
import type { LibraryEntry } from './library-query';

export function useLibrary(): { entries: LibraryEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Two sources trigger loads (liveQuery and the sync event). Only the most recently
    // started load may update state, so a slow older read can never overwrite newer data.
    let latest = 0;

    const load = async (): Promise<{ id: number; rows: LibraryEntry[] }> => {
      const id = ++latest;
      return { id, rows: await loadLibraryEntries() };
    };
    const apply = ({ id, rows }: { id: number; rows: LibraryEntry[] }) => {
      if (!active || id !== latest) return;
      setEntries(rows);
      setLoading(false);
    };
    const fail = (error: unknown) => {
      if (!active) return;
      console.error('Không tải được thư viện.', error);
      setLoading(false);
    };

    const subscription = liveQuery(load).subscribe({ next: apply, error: fail });

    // liveQuery only sees writes to tables it read; cloud sync also reports
    // changes that may come from another schema version, so reload on that event too.
    const reload = () => {
      load().then(apply, fail);
    };
    window.addEventListener(dataEvent, reload);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener(dataEvent, reload);
    };
  }, []);

  return { entries, loading };
}
