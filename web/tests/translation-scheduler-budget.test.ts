import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTranslationScheduler, type ScheduledTranslationEvent, type ContextTurn } from '@/features/recording/translation-scheduler';
import type { TranscriptSnapshot } from '@/features/recording/utterance-assembler';

function snapshot(text: string, revision: number, isFinal: boolean, captionId = 10): TranscriptSnapshot {
  return { text, revision, isFinal, captionId, blockId: 1, connectionEpoch: 1,
    providerItemId: `${captionId}`, startMs: 0, endMs: revision * 1000 };
}
const first = 'こんにちは、本日はよろしくお願いします。';
const second = '明日の午後から新しい日本語の授業が始まります。';
afterEach(() => vi.useRealTimers());

describe('history budget for every live request', () => {
  it.each([0, 1, 2, 6])('bounds final, segment and remainder to N=%i pairs', async (n) => {
    vi.useFakeTimers();
    const calls: Array<{ kind: string; history: ContextTurn[] }> = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0, earlySegments: true, historyTurns: n,
      runner: async (source, _dir, history, _signal, _snap, _delta, kind) => {
        calls.push({ kind: kind!, history }); return `D:${source}`;
      } });
    for (let id = 1; id <= 6; id++) {
      scheduler.onSnapshot(snapshot(`先の文${id}`, 1, true, id));
      await scheduler.drain();
    }
    expect(calls.at(-1)?.history).toHaveLength(Math.min(n, 5));
    scheduler.onSnapshot(snapshot(first, 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    await scheduler.drain();
    expect(calls.at(-1)).toMatchObject({ kind: 'segment' });
    expect(calls.at(-1)?.history).toHaveLength(n);
    scheduler.onSnapshot(snapshot(first + second, 2, false));
    await vi.advanceTimersByTimeAsync(1600);
    await scheduler.drain();
    expect(calls.at(-1)?.history).toHaveLength(n);
    if (n > 0) expect(calls.at(-1)?.history.at(-1)?.source).toBe(first);
    scheduler.onSnapshot(snapshot(first + second + '次は来週です。', 3, true));
    await scheduler.drain();
    expect(calls.at(-1)).toMatchObject({ kind: 'remainder' });
    expect(calls.at(-1)?.history).toHaveLength(n);
    if (n > 0) expect(calls.at(-1)?.history.at(-1)?.source).toBe(second);
    scheduler.close();
  });

  it('uses the latest setting when a queued remainder starts', async () => {
    vi.useFakeTimers();
    const histories: ContextTurn[][] = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 1000, earlySegments: true,
      runner: async (_source, _dir, history) => { histories.push(history); return 'D'; } });
    scheduler.onSnapshot(snapshot(first, 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    scheduler.onSnapshot(snapshot(first + second, 2, true));
    scheduler.setHistoryTurns(0);
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.drain();
    expect(histories.at(-1)).toEqual([]);
    scheduler.close();
  });
});

describe('in-flight segment/final races', () => {
  it.each(['failure', 'timeout'])('falls back to one full final after an early %s', async (mode) => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    let finish!: (text: string) => void;
    const kinds: Array<string | undefined> = [];
    const events: ScheduledTranslationEvent[] = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0, earlySegments: true, requestTimeoutMs: 2000,
      runner: (_source, _dir, _hist, _signal, _snapshot, _delta, kind) => {
        kinds.push(kind);
        if (kind === 'segment') return new Promise<string>((resolve, fail) => { finish = resolve; reject = fail; });
        return Promise.resolve('Bản dịch toàn câu');
      } });
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot(first, 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    scheduler.onSnapshot(snapshot(first + second, 2, true));
    if (mode === 'failure') reject(new Error('early failed'));
    else await vi.advanceTimersByTimeAsync(2100);
    await scheduler.drain();
    finish('late old translation');
    await Promise.resolve();
    expect(kinds).toEqual(['segment', 'final']);
    expect(events.at(-1)).toMatchObject({ targetText: 'Bản dịch toàn câu', sourceRevision: 2, isFinal: true });
    scheduler.close();
  });

  it('clears a stable-segment timer when early translation is turned off', async () => {
    vi.useFakeTimers();
    const runner = vi.fn(async () => 'D');
    const scheduler = new LiveTranslationScheduler({ runner, earlySegments: true, minIntervalMs: 0 });
    scheduler.onSnapshot(snapshot(first, 1, false));
    scheduler.setEarlySegments(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner).not.toHaveBeenCalled();
    scheduler.onSnapshot(snapshot(first, 2, true));
    await scheduler.drain();
    expect(runner).toHaveBeenCalledOnce();
    scheduler.close();
  });

  it('waits for an in-flight segment and requests only the remainder at the final revision', async () => {
    vi.useFakeTimers();
    let finish!: (text: string) => void;
    const calls: Array<{ source: string; kind?: string; revision?: number }> = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0, earlySegments: true,
      runner: (source, _dir, _hist, _signal, snap, _delta, kind) => {
        calls.push({ source, kind, revision: snap?.revision });
        if (calls.length === 1) return new Promise<string>((resolve) => { finish = resolve; });
        return Promise.resolve('Phần còn lại');
      } });
    scheduler.onSnapshot(snapshot(first + '続き', 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    scheduler.onSnapshot(snapshot(first + second, 2, true));
    finish('Chào');
    await scheduler.drain();
    expect(calls).toEqual([{ source: first, kind: 'segment', revision: 1 },
      { source: second, kind: 'remainder', revision: 2 }]);
    scheduler.close();
  });

  it('bounds many same-caption segments to six and preserves ASR spaces', async () => {
    vi.useFakeTimers();
    const histories: ContextTurn[][] = [];
    const sources = Array.from({ length: 8 }, (_, i) => `Đây là vế câu ổn định thứ ${i + 1} trong bài học.`);
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0, earlySegments: true, historyTurns: 6,
      runner: async (_source, _dir, history) => { histories.push(history); return 'D'; } });
    for (let i = 0; i < sources.length; i++) {
      scheduler.onSnapshot(snapshot(sources.slice(0, i + 1).join(' '), i + 1, false));
      await vi.advanceTimersByTimeAsync(1600);
      await scheduler.drain();
    }
    scheduler.onSnapshot(snapshot(sources.join(' ') + ' Hết.', 9, true));
    await scheduler.drain();
    expect(histories).toHaveLength(9);
    expect(histories.at(-1)?.map((turn) => turn.source)).toEqual(sources.slice(-6));
    scheduler.close();
  });

  it('drops late deltas and completion after closing the scheduler', async () => {
    let finish!: (text: string) => void;
    let delta!: (text: string) => void;
    const events: ScheduledTranslationEvent[] = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0,
      runner: (_source, _dir, _hist, _signal, _snapshot, onDelta) => {
        delta = onDelta!; return new Promise<string>((resolve) => { finish = resolve; });
      } });
    scheduler.subscribe((e) => events.push(e));
    scheduler.onSnapshot(snapshot(first, 1, true));
    scheduler.close();
    const count = events.length;
    delta('late'); finish('late');
    await scheduler.drain(); await Promise.resolve();
    expect(events).toHaveLength(count);
  });

  it('does not translate a final twice when it arrives during a matching segment', async () => {
    vi.useFakeTimers();
    let finish!: (text: string) => void;
    const runner = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const scheduler = new LiveTranslationScheduler({ runner, earlySegments: true, minIntervalMs: 0 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot(first + '続き', 1, false));
    await vi.advanceTimersByTimeAsync(1600);
    scheduler.onSnapshot(snapshot(first, 2, true));
    finish('Xin chào');
    await Promise.resolve(); await Promise.resolve();
    // Finish any duplicate too: the regression must fail without hanging.
    finish('Xin chào');
    await scheduler.drain();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ targetText: 'Xin chào', isFinal: true });
    scheduler.close();
  });

  it('rejects a stale final even if the corrected source contains its whole text', async () => {
    const requests: Array<{ finish: (text: string) => void; delta: (text: string) => void }> = [];
    const scheduler = new LiveTranslationScheduler({ minIntervalMs: 0,
      runner: (_source, _dir, _history, _signal, _snap, delta) => new Promise<string>((resolve) => {
        requests.push({ finish: resolve, delta: delta! });
      }) });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot('参加できます', 1, true));
    scheduler.onSnapshot(snapshot('「参加できます」とは言っていません', 2, true));
    requests[0].delta('Có thể tham gia');
    requests[0].finish('Có thể tham gia');
    await Promise.resolve(); await Promise.resolve();
    requests[1].finish('Tôi không nói rằng có thể tham gia');
    await scheduler.drain();
    expect(events.some((e) => e.sourceRevision === 2 && e.targetText === 'Có thể tham gia')).toBe(false);
    scheduler.close();
  });
});
