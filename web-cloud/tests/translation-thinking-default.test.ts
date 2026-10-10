import { describe, expect, it } from 'vitest';
import { defaultTranslationThinkingLevel } from '@/server/ai/translate';

describe('defaultTranslationThinkingLevel', () => {
  it('uses the fastest level for partial segments', () => {
    expect(defaultTranslationThinkingLevel('segment', ['minimal', 'low', 'medium', 'high'])).toBe('minimal');
    expect(defaultTranslationThinkingLevel('remainder', ['minimal', 'high'])).toBe('minimal');
  });

  it('uses a light level for final text instead of the model default', () => {
    expect(defaultTranslationThinkingLevel('final', ['minimal', 'low', 'medium', 'high'])).toBe('low');
    expect(defaultTranslationThinkingLevel(undefined, ['minimal', 'low', 'medium', 'high'])).toBe('low');
  });

  it('falls back to what the model supports', () => {
    expect(defaultTranslationThinkingLevel('final', ['minimal', 'high'])).toBe('minimal');
    expect(defaultTranslationThinkingLevel('final', ['low', 'medium', 'high'])).toBe('low');
    expect(defaultTranslationThinkingLevel('segment', ['low', 'medium', 'high'])).toBe('low');
  });

  it('leaves models without thinking levels alone', () => {
    expect(defaultTranslationThinkingLevel('final', undefined)).toBeUndefined();
    expect(defaultTranslationThinkingLevel('final', ['high'])).toBeUndefined();
  });
});
