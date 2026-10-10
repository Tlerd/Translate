import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { pickActiveSection, type SectionPosition } from './settings-sections';

const WIDE_LAYOUT_QUERY = '(min-width: 960px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** How long a programmatic scroll may hold the active section before measurements resume. */
const SCROLL_LOCK_MS = 1500;

/** Space kept clear above a section: the sticky tab bar on phones, a small gap on laptops. */
function clearanceAboveSection(): number {
  return window.matchMedia(WIDE_LAYOUT_QUERY).matches ? 24 : 72;
}

/**
 * Tracks which settings section is in view and scrolls the page to a section.
 * The settings page is its own scroll container, so every offset is measured against that element.
 */
export function useSettingsSections(scrollRef: RefObject<HTMLElement | null>, sectionIds: readonly string[]) {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? '');
  const idsKey = sectionIds.join(' ');
  // While a click-initiated smooth scroll runs, measurements must not flip the highlight through
  // the sections it passes on the way to the target.
  const lockRef = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    const ids = idsKey ? idsKey.split(' ') : [];
    if (!root || ids.length === 0) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      const positions: SectionPosition[] = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) positions.push({ id, top: el.getBoundingClientRect().top - rootTop });
      }
      const scrollable = root.scrollHeight > root.clientHeight;
      const atEnd = scrollable && root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
      const next = pickActiveSection(positions, clearanceAboveSection() + 8, atEnd);
      if (!next) return;
      const lock = lockRef.current;
      if (lock) {
        if (next !== lock.id) return;
        window.clearTimeout(lock.timer);
        lockRef.current = null;
      }
      setActiveId(next);
    };

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    // The observer watches a band that starts at the reading line. Its events cover sections
    // entering and leaving the band; the scroll listener covers the cases an intersection event
    // misses, such as a tall section whose top crosses the line while it stays in the band.
    const observer = new IntersectionObserver(schedule, {
      root,
      rootMargin: `-${clearanceAboveSection() + 8}px 0px -40% 0px`,
      threshold: 0,
    });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [scrollRef, idsKey]);

  useEffect(() => {
    const lock = lockRef;
    return () => {
      if (lock.current) window.clearTimeout(lock.current.timer);
    };
  }, []);

  const scrollTo = useCallback(
    (target: HTMLElement, behavior: ScrollBehavior) => {
      const root = scrollRef.current;
      if (!root) return;
      const top =
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        clearanceAboveSection();
      root.scrollTo({ top: Math.max(0, top), behavior });
    },
    [scrollRef]
  );

  const scrollToSection = useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;
      const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
      if (lockRef.current) window.clearTimeout(lockRef.current.timer);
      const timer = window.setTimeout(() => {
        lockRef.current = null;
      }, SCROLL_LOCK_MS);
      lockRef.current = { id, timer };
      setActiveId(id);
      // replaceState keeps Next's router state and does not jump the page, unlike assigning location.hash.
      window.history.replaceState(window.history.state, '', `#${id}`);
      scrollTo(target, reduceMotion ? 'auto' : 'smooth');
    },
    [scrollTo]
  );

  // Opening the page on a section link (for example #speech-test) scrolls there without animation.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const target = hash ? document.getElementById(hash) : null;
    if (target) scrollTo(target, 'auto');
  }, [scrollTo]);

  return { activeId, scrollToSection };
}
