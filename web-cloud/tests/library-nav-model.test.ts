import { describe, it, expect } from 'vitest';
import {
  FOLDER_NAME_MAX_LENGTH,
  buildLibraryHref,
  normalizeFolderName,
  parseNavSelection,
} from '@/features/library/library-nav-model';
import { FOLDER_NONE } from '@/features/library/library-query';

describe('buildLibraryHref', () => {
  it('returns the bare library path when nothing is selected', () => {
    expect(buildLibraryHref()).toBe('/library');
    expect(buildLibraryHref({})).toBe('/library');
    expect(buildLibraryHref({ view: 'all' })).toBe('/library');
    expect(buildLibraryHref({ folder: '' })).toBe('/library');
  });

  it('omits the default view and keeps other views', () => {
    expect(buildLibraryHref({ view: 'trash' })).toBe('/library?view=trash');
    expect(buildLibraryHref({ view: 'starred' })).toBe('/library?view=starred');
  });

  it('encodes Vietnamese folder names and the uncategorized marker', () => {
    const href = buildLibraryHref({ folder: 'Lớp Tiếng Nhật & Toán' });
    expect(href.startsWith('/library?folder=')).toBe(true);
    expect(href).not.toContain(' ');
    expect(href).not.toContain('&Toán');
    expect(buildLibraryHref({ folder: FOLDER_NONE })).toBe('/library?folder=_none');
  });
});

describe('parseNavSelection', () => {
  it('defaults to the all view with no folder', () => {
    expect(parseNavSelection(new URLSearchParams(''))).toEqual({ view: 'all', folder: '' });
  });

  it('falls back to all for an unknown view', () => {
    expect(parseNavSelection(new URLSearchParams('view=bogus')).view).toBe('all');
    expect(parseNavSelection(new URLSearchParams('view=ALL')).view).toBe('all');
  });

  it('keeps a known view and reads the folder, including _none', () => {
    expect(parseNavSelection(new URLSearchParams('view=trash&folder=_none'))).toEqual({
      view: 'trash',
      folder: FOLDER_NONE,
    });
  });

  it('round trips Vietnamese folder names through buildLibraryHref', () => {
    const names = ['Đức', 'Lớp A+B', 'Tiếng Việt & Anh', '100% thật'];
    for (const name of names) {
      const href = buildLibraryHref({ folder: name });
      const query = href.slice(href.indexOf('?') + 1);
      expect(parseNavSelection(new URLSearchParams(query)).folder).toBe(name);
    }
  });
});

describe('normalizeFolderName', () => {
  it('trims and accepts a new name', () => {
    expect(normalizeFolderName('  Lớp Đọc  ', ['Anh'])).toEqual({ ok: true, name: 'Lớp Đọc' });
  });

  it('rejects empty or whitespace-only names', () => {
    expect(normalizeFolderName('', [])).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeFolderName('   \t ', [])).toEqual({ ok: false, reason: 'empty' });
  });

  it('accepts exactly 120 characters and rejects 121', () => {
    const max = 'a'.repeat(FOLDER_NAME_MAX_LENGTH);
    expect(normalizeFolderName(max, [])).toEqual({ ok: true, name: max });
    expect(normalizeFolderName(`${max}a`, [])).toEqual({ ok: false, reason: 'too_long' });
  });

  it('rejects duplicates regardless of case and diacritics', () => {
    expect(normalizeFolderName('LỚP ĐỌC', ['lớp đọc'])).toEqual({ ok: false, reason: 'duplicate' });
    expect(normalizeFolderName('Lop Doc', ['Lớp Đọc'])).toEqual({ ok: false, reason: 'duplicate' });
    expect(normalizeFolderName('  anh ', ['Anh'])).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('does not treat different words as duplicates', () => {
    expect(normalizeFolderName('Lớp Đọc 2', ['Lớp Đọc'])).toEqual({ ok: true, name: 'Lớp Đọc 2' });
  });

  it('reserves the uncategorized marker', () => {
    expect(normalizeFolderName('_none', [])).toEqual({ ok: false, reason: 'reserved' });
  });
});
