import { describe, expect, it } from 'vitest';
import {
  segmenterOptionsFor,
  stablePrefixCandidate,
  splitFinal,
  joinTranslations,
  findLastSentenceBoundary,
} from '@/features/recording/stable-segmenter';

describe('stable-segmenter', () => {
  describe('segmenterOptionsFor', () => {
    it('returns stableMs >= 1500 and pauseMs + 600', () => {
      expect(segmenterOptionsFor(600)).toEqual({ stableMs: 1500, minChars: 20 });
      expect(segmenterOptionsFor(900)).toEqual({ stableMs: 1500, minChars: 20 });
      expect(segmenterOptionsFor(1200)).toEqual({ stableMs: 1800, minChars: 20 });
      expect(segmenterOptionsFor(2000)).toEqual({ stableMs: 2600, minChars: 20 });
    });
  });

  describe('findLastSentenceBoundary and stablePrefixCandidate', () => {
    it('detects Japanese and Western sentence boundaries', () => {
      expect(findLastSentenceBoundary('こんにちは。元気ですか？はい！')).toBe(15);
      expect(findLastSentenceBoundary('Hello world. How are you! Great.')).toBe(32);
      expect(findLastSentenceBoundary('No boundary here')).toBe(-1);
      // Ignores decimal numbers
      expect(findLastSentenceBoundary('Version 3.14 is cool')).toBe(-1);
    });

    it('extracts stable prefix candidate when length >= minChars', () => {
      const text = 'こんにちは、本日はよろしくお願いします。午後から雨が降るそうです';
      const candidate = stablePrefixCandidate(text, [], 20);
      expect(candidate).toBe('こんにちは、本日はよろしくお願いします。');
    });

    it('returns null when candidate is shorter than minChars', () => {
      const text = 'はい、そうです。午後から雨が降るそうです';
      const candidate = stablePrefixCandidate(text, [], 20);
      expect(candidate).toBeNull();
    });

    it('accounts for previously committed segments', () => {
      const committed = ['こんにちは、本日はよろしくお願いします。'];
      const text = 'こんにちは、本日はよろしくお願いします。午後から雨が降るそうですので傘をお持ちください。追加テキスト';
      const candidate = stablePrefixCandidate(text, committed, 20);
      expect(candidate).toBe('午後から雨が降るそうですので傘をお持ちください。');
    });

    it('returns null when text does not start with committed segments', () => {
      const committed = ['Câu một trước đó.'];
      const text = 'Câu hoàn toàn khác.';
      expect(stablePrefixCandidate(text, committed, 10)).toBeNull();
    });
  });

  describe('splitFinal', () => {
    it('does not reuse a positive segment after punctuation removal extends it into negation', () => {
      expect(splitFinal('I cannot attend.', ['I can.'])).toEqual({ kind: 'mismatch' });
      expect(splitFinal('できるわけではありません。', ['できる。'])).toEqual({ kind: 'mismatch' });
    });
    it('reuses multiple trimmed segments separated by ASR whitespace', () => {
      expect(splitFinal('Câu một.  Câu hai. Câu ba.', ['Câu một.', 'Câu hai.']))
        .toEqual({ kind: 'remainder', remainder: 'Câu ba.' });
      expect(stablePrefixCandidate('Câu một.  Câu hai. Câu ba.', ['Câu một.', 'Câu hai.'], 1)).toBe('Câu ba.');
    });
    it('returns reuse when final text matches committed segments', () => {
      const committed = ['Xin chào mọi người.'];
      expect(splitFinal('Xin chào mọi người.', committed)).toEqual({ kind: 'reuse' });
      expect(splitFinal('Xin chào mọi người', committed)).toEqual({ kind: 'reuse' });
      expect(splitFinal('Xin chào mọi người。', committed)).toEqual({ kind: 'reuse' });
    });

    it('returns remainder when final text extends committed segments', () => {
      const committed = ['Xin chào mọi người.'];
      const result = splitFinal('Xin chào mọi người. Hôm nay chúng ta học tiếp.', committed);
      expect(result).toEqual({ kind: 'remainder', remainder: 'Hôm nay chúng ta học tiếp.' });
    });

    it('returns remainder when final text punctuation slightly differs', () => {
      const committed = ['Xin chào mọi người.'];
      const result = splitFinal('Xin chào mọi người! Hôm nay chúng ta học tiếp.', committed);
      expect(result).toEqual({ kind: 'remainder', remainder: 'Hôm nay chúng ta học tiếp.' });
    });

    it('returns mismatch when final text does not match committed prefix', () => {
      const committed = ['Tôi có thể tham gia.'];
      const result = splitFinal('Tôi không thể tham gia vào ngày mai.', committed);
      expect(result).toEqual({ kind: 'mismatch' });
    });

    it('returns mismatch if committed is empty', () => {
      expect(splitFinal('Xin chào', [])).toEqual({ kind: 'mismatch' });
    });
  });

  describe('joinTranslations', () => {
    it('joins non-CJK translations with space', () => {
      expect(joinTranslations(['Xin chào.', 'Hôm nay trời đẹp.'], 'vi')).toBe('Xin chào. Hôm nay trời đẹp.');
      expect(joinTranslations(['Hello.', 'How are you?'], 'en')).toBe('Hello. How are you?');
    });

    it('joins CJK translations without space', () => {
      expect(joinTranslations(['こんにちは。', 'いい天気ですね。'], 'ja')).toBe('こんにちは。いい天気ですね。');
      expect(joinTranslations(['你好。', '今天天气很好。'], 'zh')).toBe('你好。今天天气很好。');
    });

    it('handles empty parts', () => {
      expect(joinTranslations(['', '   '], 'vi')).toBe('');
      expect(joinTranslations(['Part 1', '', 'Part 2'], 'vi')).toBe('Part 1 Part 2');
    });
  });
});
