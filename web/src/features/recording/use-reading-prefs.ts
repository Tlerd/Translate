import { useCallback, useEffect, useState } from 'react';
import {
  parseReadingDisplay,
  parseReadingScale,
  stepReadingScale,
  type ReadingDisplay,
} from './reading-prefs';

const SCALE_KEY = 'reading_scale';
const DISPLAY_KEY = 'reading_display';

/** Reading-mode state shared by the laptop and phone recording screens, remembered per browser. */
export function useReadingPrefs() {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(() => parseReadingScale(null));
  const [display, setDisplay] = useState<ReadingDisplay>('both');

  useEffect(() => {
    try {
      setScale(parseReadingScale(localStorage.getItem(SCALE_KEY)));
      setDisplay(parseReadingDisplay(localStorage.getItem(DISPLAY_KEY)));
    } catch {
      // Preferences are a convenience only.
    }
  }, []);

  const changeScale = useCallback((direction: 1 | -1) => {
    setScale((current) => {
      const next = stepReadingScale(current, direction);
      try { localStorage.setItem(SCALE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const changeDisplay = useCallback((next: ReadingDisplay) => {
    setDisplay(next);
    try { localStorage.setItem(DISPLAY_KEY, next); } catch { /* ignore */ }
  }, []);

  const enter = useCallback(() => setOpen(true), []);
  const exit = useCallback(() => setOpen(false), []);

  return { open, scale, display, changeScale, changeDisplay, enter, exit };
}
