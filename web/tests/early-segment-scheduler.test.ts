import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LiveTranslationScheduler,
  type ScheduledTranslationEvent,
  type ContextTurn,
} from '@/features/recording/translation-scheduler';
import type { TranscriptSnapshot } from '@/features/recording/utterance-assembler';

function makeSnapshot(
  text: string,
  revision: number,
  isFinal = false,
  captionId = 1
): TranscriptSnapshot {
  return {
    connectionEpoch: 1,
    providerItemId: `utterance-${captionId}`,
    captionId,
    blockId: 1,
    text,
    revision,
    isFinal,
    startMs: 0,
    endMs: revision * 1000,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Cost-aware early segment translation in LiveTranslationScheduler', () => {
  it('triggers zero interim calls when earlySegments is disabled', async () => {
    vi.useFakeTimers();
    const runner = vi.fn(async (source: string) => `Dịch: ${source}`);
    const scheduler = new LiveTranslationScheduler({
      runner,
      earlySegments: false,
      pauseMs: 900,
      minIntervalMs: 0,
    });

    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((e) => events.push(e));

    // Emit interim text with full sentence boundary and >= 20 chars
    scheduler.onSnapshot(
      makeSnapshot('こんにちは、本日はよろしくお願いします。午後から雨が', 1, false)
    );
    await vi.advanceTimersByTimeAsync(3000);

    expect(runner).not.toHaveBeenCalled();

    // Final arrives
    scheduler.onSnapshot(
      makeSnapshot('こんにちは、本日はよろしくお願いします。午後から雨が降るそうです。', 2, true)
    );
    await vi.advanceTimersByTimeAsync(100);
    await scheduler.drain();
    scheduler.close();

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'こんにちは、本日はよろしくお願いします。午後から雨が降るそうです。',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'final'
    );
  });

  it('translates stable segment early and reuses it on exact/equivalent final', async () => {
    vi.useFakeTimers();
    const calls: Array<{ source: string; kind?: string }> = [];
    const runner = vi.fn(
      async (
        source: string,
        _dir: unknown,
        _hist: unknown,
        _sig: unknown,
        _snap: unknown,
        _delta: unknown,
        kind?: 'final' | 'segment' | 'remainder'
      ) => {
        calls.push({ source, kind });
        return `[${kind ?? 'final'}] ${source}`;
      }
    );

    const scheduler = new LiveTranslationScheduler({
      runner,
      earlySegments: true,
      pauseMs: 900, // stableMs = 1500
      minIntervalMs: 0,
      targetLanguage: 'vi',
    });

    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((e) => events.push(e));

    // Interim text: sentence boundary at index 20
    const sentence1 = 'こんにちは、本日はよろしくお願いします。';
    scheduler.onSnapshot(makeSnapshot(sentence1, 1, false));

    // Advance 1400ms (not yet 1500ms)
    await vi.advanceTimersByTimeAsync(1400);
    expect(runner).not.toHaveBeenCalled();

    // Advance past 1500ms -> segment triggers
    await vi.advanceTimersByTimeAsync(200);
    await scheduler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      source: sentence1,
      kind: 'segment',
    });

    // Check that interim translation was emitted
    const interimEvent = events.find((e) => e.targetText.includes(sentence1));
    expect(interimEvent).toBeDefined();
    expect(interimEvent?.isFinal).toBe(false);

    // Now final arrives with exact equivalent (no remainder)
    scheduler.onSnapshot(makeSnapshot(sentence1, 2, true));
    await scheduler.drain();
    scheduler.close();

    // No extra calls needed (reused!)
    expect(calls).toHaveLength(1);

    const finalEvent = events.at(-1);
    expect(finalEvent?.isFinal).toBe(true);
    expect(finalEvent?.targetText).toBe(`[segment] ${sentence1}`);
  });

  it('translates only remainder when final extends early-translated segment', async () => {
    vi.useFakeTimers();
    const calls: Array<{ source: string; kind?: string; history: ContextTurn[] }> = [];
    const runner = vi.fn(
      async (
        source: string,
        _dir: unknown,
        history: ContextTurn[],
        _sig: unknown,
        _snap: unknown,
        _delta: unknown,
        kind?: 'final' | 'segment' | 'remainder'
      ) => {
        calls.push({ source, kind, history });
        return `Dịch(${source})`;
      }
    );

    const scheduler = new LiveTranslationScheduler({
      runner,
      earlySegments: true,
      pauseMs: 900,
      minIntervalMs: 0,
      targetLanguage: 'vi',
    });

    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((e) => events.push(e));

    const sentence1 = 'こんにちは、本日はよろしくお願いします。';
    const sentence2 = '午後から雨が降るそうです。';
    const fullText = `${sentence1} ${sentence2}`;

    // Interim sentence 1
    scheduler.onSnapshot(makeSnapshot(sentence1, 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    await scheduler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(sentence1);
    expect(calls[0].kind).toBe('segment');

    // User speaks sentence 2 and stops -> final arrives
    scheduler.onSnapshot(makeSnapshot(fullText, 2, true));
    await vi.advanceTimersByTimeAsync(100);
    await scheduler.drain();
    scheduler.close();

    expect(calls).toHaveLength(2);
    expect(calls[1].source).toBe(sentence2);
    expect(calls[1].kind).toBe('remainder');

    // Context for remainder includes the committed segment
    expect(calls[1].history).toEqual([
      { source: sentence1, translation: `Dịch(${sentence1})` },
    ]);

    // Final event joined both parts
    const finalEvent = events.at(-1);
    expect(finalEvent?.isFinal).toBe(true);
    expect(finalEvent?.targetText).toBe(`Dịch(${sentence1}) Dịch(${sentence2})`);
  });

  it('translates full final when ASR text mismatches early-translated prefix', async () => {
    vi.useFakeTimers();
    const calls: Array<{ source: string; kind?: string }> = [];
    const runner = vi.fn(
      async (
        source: string,
        _dir: unknown,
        _hist: unknown,
        _sig: unknown,
        _snap: unknown,
        _delta: unknown,
        kind?: 'final' | 'segment' | 'remainder'
      ) => {
        calls.push({ source, kind });
        return `Dịch: ${source}`;
      }
    );

    const scheduler = new LiveTranslationScheduler({
      runner,
      earlySegments: true,
      pauseMs: 900,
      minIntervalMs: 0,
      targetLanguage: 'vi',
    });

    // Interim recognition
    scheduler.onSnapshot(makeSnapshot('Tôi có thể tham dự vào ngày mai.', 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    await scheduler.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('segment');

    // Final corrected the early portion: "Tôi không thể..." instead of "Tôi có thể..."
    scheduler.onSnapshot(
      makeSnapshot('Tôi không thể tham dự vào ngày mai vì bận việc.', 2, true)
    );
    await vi.advanceTimersByTimeAsync(100);
    await scheduler.drain();
    scheduler.close();

    // Must translate full final due to mismatch
    expect(calls).toHaveLength(2);
    expect(calls[1].kind).toBe('final');
    expect(calls[1].source).toBe('Tôi không thể tham dự vào ngày mai vì bận việc.');
  });

  it('records exactly one turn in history per caption after early segment + remainder', async () => {
    vi.useFakeTimers();
    const calls: Array<{ source: string; history: ContextTurn[] }> = [];
    const scheduler = new LiveTranslationScheduler({
      runner: async (source, _dir, history, _sig, _snap, _del, kind) => {
        calls.push({ source, history });
        return `[${kind}] ${source}`;
      },
      earlySegments: true,
      pauseMs: 900,
      minIntervalMs: 0,
      targetLanguage: 'vi',
    });

    // Caption 1: early segment + remainder
    const s1 = 'Đây là câu thứ nhất của bài học.';
    const s2 = 'Còn đây là câu thứ hai nối tiếp.';
    scheduler.onSnapshot(makeSnapshot(s1, 1, false, 1));
    await vi.advanceTimersByTimeAsync(1600);
    await scheduler.drain();

    scheduler.onSnapshot(makeSnapshot(`${s1} ${s2}`, 2, true, 1));
    await vi.advanceTimersByTimeAsync(100);
    await scheduler.drain();

    // Caption 2: check what context it receives
    scheduler.onSnapshot(makeSnapshot('Đây là câu của lượt tiếp theo.', 1, true, 2));
    await vi.advanceTimersByTimeAsync(100);
    await scheduler.drain();
    scheduler.close();

    // Caption 2 runner call should see exactly 1 turn for Caption 1 (joined)
    const caption2Call = calls.at(-1);
    expect(caption2Call?.history).toHaveLength(1);
    expect(caption2Call?.history[0].source).toBe(`${s1} ${s2}`);
    expect(caption2Call?.history[0].translation).toBe(`[segment] ${s1} [remainder] ${s2}`);
  });
});
