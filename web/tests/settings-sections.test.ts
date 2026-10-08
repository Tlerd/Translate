import { describe, expect, it } from 'vitest';
import { pickActiveSection, type SectionPosition } from '@/features/settings/settings-sections';

const SECTIONS: SectionPosition[] = [
  { id: 'appearance-account', top: 40 },
  { id: 'ai-config', top: 420 },
  { id: 'connection-tests', top: 1100 },
  { id: 'usage-cost', top: 1500 },
];

describe('pickActiveSection', () => {
  it('returns null when the page has no sections', () => {
    expect(pickActiveSection([], 80, false)).toBeNull();
  });

  it('keeps the first section while every section is still below the reading line', () => {
    const below: SectionPosition[] = [
      { id: 'appearance-account', top: 200 },
      { id: 'ai-config', top: 600 },
    ];
    expect(pickActiveSection(below, 80, false)).toBe('appearance-account');
  });

  it('selects the last section whose top has passed the reading line', () => {
    expect(pickActiveSection(SECTIONS, 500, false)).toBe('ai-config');
    expect(pickActiveSection(SECTIONS, 1100, false)).toBe('connection-tests');
  });

  it('does not fall back to an earlier section when the line sits in a gap', () => {
    expect(pickActiveSection(SECTIONS, 1200, false)).toBe('connection-tests');
  });

  it('selects the last section at the bottom of a scrollable page', () => {
    expect(pickActiveSection(SECTIONS, 80, true)).toBe('usage-cost');
  });
});
