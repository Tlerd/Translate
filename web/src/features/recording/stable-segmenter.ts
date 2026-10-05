import { LiveTranslationScheduler } from './translation-scheduler';

export interface SegmenterOptions {
  stableMs: number;
  minChars: number;
}

export function segmenterOptionsFor(pauseMs: number): SegmenterOptions {
  return {
    stableMs: Math.max(1500, pauseMs + 600),
    minChars: 20,
  };
}

export function findLastSentenceBoundary(text: string): number {
  let lastEnd = -1;
  const regex = /[。！？!?．]|\.(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  return lastEnd;
}

export function stablePrefixCandidate(
  text: string,
  committed: string[] | string,
  minChars: number = 20
): string | null {
  const committedStr = Array.isArray(committed) ? committed.join('') : committed;
  if (!text.startsWith(committedStr)) {
    return null;
  }

  const uncommitted = text.slice(committedStr.length);
  const boundaryEnd = findLastSentenceBoundary(uncommitted);
  if (boundaryEnd <= 0) {
    return null;
  }

  const candidate = uncommitted.slice(0, boundaryEnd).trim();
  if (candidate.length < minChars) {
    return null;
  }

  return candidate;
}

export type SplitFinalResult =
  | { kind: 'reuse' }
  | { kind: 'remainder'; remainder: string }
  | { kind: 'mismatch' };

export function splitFinal(finalText: string, committed: string[]): SplitFinalResult {
  const committedTotal = committed.join('').trim();
  const trimmedFinal = finalText.trim();

  if (!committedTotal) {
    return { kind: 'mismatch' };
  }

  if (LiveTranslationScheduler.isEquivalentMeaning(trimmedFinal, committedTotal)) {
    return { kind: 'reuse' };
  }

  if (trimmedFinal.startsWith(committedTotal)) {
    const remainder = trimmedFinal.slice(committedTotal.length).trim();
    if (!remainder || LiveTranslationScheduler.isEquivalentMeaning(remainder, '')) {
      return { kind: 'reuse' };
    }
    return { kind: 'remainder', remainder };
  }

  const normalize = (s: string) => s.replace(/[\s\.,!\?、。！？]+$/g, '').trim();
  const normCommitted = normalize(committedTotal);
  if (normCommitted && trimmedFinal.startsWith(normCommitted)) {
    const rawRemainder = trimmedFinal.slice(normCommitted.length);
    const cleanRemainder = rawRemainder.replace(/^[\s\.,!\?、。！？]+/, '').trim();
    if (!cleanRemainder) {
      return { kind: 'reuse' };
    }
    return { kind: 'remainder', remainder: cleanRemainder };
  }

  return { kind: 'mismatch' };
}

export function joinTranslations(parts: string[], targetCode: string): string {
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) return '';
  const isCjk = targetCode.startsWith('ja') || targetCode.startsWith('zh');
  if (isCjk) {
    return cleaned.join('');
  }
  return cleaned.join(' ');
}
