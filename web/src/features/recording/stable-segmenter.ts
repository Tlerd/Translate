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
  const uncommitted = remainingAfterCommitted(text, Array.isArray(committed) ? committed : [committed]);
  if (uncommitted === null) return null;
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

// Segment sources are trimmed; ASR may keep whitespace between them.
export function remainingAfterCommitted(text: string, committed: string[]): string | null {
  let remaining = text.trimStart();
  for (const source of committed) {
    const part = source.trim();
    if (!remaining.startsWith(part)) return null;
    remaining = remaining.slice(part.length).trimStart();
  }
  return remaining;
}

export type SplitFinalResult =
  | { kind: 'reuse' }
  | { kind: 'remainder'; remainder: string }
  | { kind: 'mismatch' };

export function splitFinal(finalText: string, committed: string[]): SplitFinalResult {
  if (committed.length > 1) {
    const remaining = remainingAfterCommitted(finalText, committed.slice(0, -1));
    return remaining === null ? { kind: 'mismatch' } : splitFinal(remaining, committed.slice(-1));
  }
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
    // A removed sentence mark must not turn a corrected word/negation into
    // an apparent remainder ("can." -> "cannot", "できる。" -> "できるわけではない").
    if (rawRemainder && !/^[\s\.,!\?、。！？]/.test(rawRemainder)) return { kind: 'mismatch' };
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
