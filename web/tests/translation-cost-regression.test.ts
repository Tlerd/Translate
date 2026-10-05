import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTranslationScheduler, type ScheduledTranslationEvent } from '@/features/recording/translation-scheduler';
import type { TranscriptSnapshot } from '@/features/recording/utterance-assembler';

function snapshot(text: string, revision: number, isFinal = false): TranscriptSnapshot {
  return { connectionEpoch: 1, providerItemId: 'utterance-1', captionId: 1, blockId: 1, text, revision, isFinal, startMs: 0, endMs: revision * 800 };
}

afterEach(() => vi.useRealTimers());

describe('live translation cost and committed output', () => {
  it('shows evolving ASR text immediately but translates one committed utterance once', async () => {
    vi.useFakeTimers();
    const runner = vi.fn(async (source: string) => `Dịch: ${source}`);
    const scheduler = new LiveTranslationScheduler({ runner });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));

    for (let revision = 1; revision <= 8; revision++) {
      scheduler.onSnapshot(snapshot(`unfinished phrase ${revision}`, revision));
      expect(events.at(-1)?.sourceText).toBe(`unfinished phrase ${revision}`);
      await vi.advanceTimersByTimeAsync(800);
    }
    const provisionalCalls = runner.mock.calls.length;
    const provisionalTargets = events.filter((event) => event.targetText);
    scheduler.onSnapshot(snapshot('completed phrase', 9, true));
    await vi.advanceTimersByTimeAsync(800);
    await scheduler.drain();
    scheduler.close();

    expect(provisionalCalls).toBe(0);
    expect(provisionalTargets).toHaveLength(0);
    expect(runner.mock.calls.map((call) => call[0])).toEqual(['completed phrase']);
    expect(events.at(-1)).toMatchObject({ targetText: 'Dịch: completed phrase', isFinal: true });
  });

  it('reuses equivalent final revisions while streaming and after completion', async () => {
    let finish!: (text: string) => void;
    const runner = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot('こんにちは', 1, true));
    scheduler.onSnapshot(snapshot('こんにちは。', 2, true));
    finish('Xin chào');
    await Promise.resolve();
    await Promise.resolve();
    // Let an unnecessary second request finish too, so the failing loop cannot hang.
    finish('Xin chào');
    await scheduler.drain();
    scheduler.onSnapshot(snapshot('こんにちは。 ', 3, true));
    finish('Xin chào');
    await scheduler.drain();
    scheduler.close();
    expect(runner).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ sourceRevision: 3, targetSourceRevision: 3, targetText: 'Xin chào', isFinal: true });
  });

  it('does not publish an old stream against a corrected final source', async () => {
    const requests: Array<{ delta: (text: string) => void; finish: (text: string) => void }> = [];
    const runner = vi.fn((_source, _direction, _history, _signal, _snapshot, delta) => new Promise<string>((resolve) => {
      requests.push({ delta, finish: resolve });
    }));
    const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot('I can attend', 1, true));
    scheduler.onSnapshot(snapshot('I cannot attend', 2, true));
    requests[0].delta('Tôi có thể tham dự');
    requests[0].finish('Tôi có thể tham dự');
    await Promise.resolve();
    await Promise.resolve();
    requests[1].delta('Tôi không thể tham dự');
    requests[1].finish('Tôi không thể tham dự');
    await scheduler.drain();
    scheduler.close();
    expect(events.some((event) => event.sourceRevision === 2 && event.targetText === 'Tôi có thể tham dự')).toBe(false);
    expect(events.at(-1)).toMatchObject({ sourceRevision: 2, targetSourceRevision: 2, targetText: 'Tôi không thể tham dự', isFinal: true });
  });

  it('does not restore an older completed target over a corrected stream on an equivalent final revision', async () => {
    let finish!: (text: string) => void;
    let delta!: (text: string) => void;
    const scheduler = new LiveTranslationScheduler({
      minIntervalMs: 0,
      runner: (source, _direction, _history, _signal, _snapshot, onDelta) => {
        if (source === 'I can attend') return Promise.resolve('Tôi có thể tham dự');
        delta = onDelta!;
        return new Promise<string>((resolve) => { finish = resolve; });
      },
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot('I can attend', 1, true));
    await scheduler.drain();
    scheduler.onSnapshot(snapshot('I cannot attend', 2, true));
    delta('Tôi không thể tham dự');
    scheduler.onSnapshot(snapshot('I cannot attend.', 3, true));
    const sourceUpdate = events.at(-1);
    finish('Tôi không thể tham dự');
    await scheduler.drain();
    scheduler.close();
    expect(sourceUpdate).toMatchObject({ sourceRevision: 3, targetText: 'Tôi không thể tham dự' });
  });

  it('times out a stalled request and still drains queued finals while rejecting its late completion', async () => {
    vi.useFakeTimers();
    let finishOld!: (text: string) => void;
    let oldSignal!: AbortSignal;
    const runner = vi.fn((source, _direction, _history, signal) => {
      if (source === 'first') {
        oldSignal = signal;
        return new Promise<string>((resolve) => { finishOld = resolve; });
      }
      return Promise.resolve('second translation');
    });
    const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0, requestTimeoutMs: 1000 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot(snapshot('first', 1, true));
    scheduler.onSnapshot({ ...snapshot('second', 1, true), captionId: 2, providerItemId: 'utterance-2' });
    const drained = scheduler.drain();
    await vi.advanceTimersByTimeAsync(1000);
    await drained;
    finishOld('late old translation');
    await vi.advanceTimersByTimeAsync(0);
    scheduler.close();
    expect(oldSignal.aborted).toBe(true);
    expect(runner.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
    expect(events.find((event) => event.error)).toMatchObject({ captionId: 1, error: 'Hết thời gian dịch live' });
    expect(events.at(-1)).toMatchObject({ captionId: 2, targetText: 'second translation', isFinal: true });
    expect(events.some((event) => event.targetText === 'late old translation')).toBe(false);
  });

  it('replaces corrected context in place and excludes the caption being corrected', async () => {
    const histories: Array<Array<{ source: string; translation: string }>> = [];
    const runner = vi.fn(async (source, _direction, history) => {
      histories.push(history);
      return `Dịch: ${source}`;
    });
    const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0 });
    scheduler.onSnapshot(snapshot('first', 1, true));
    await scheduler.drain();
    scheduler.onSnapshot({ ...snapshot('second', 1, true), captionId: 2, providerItemId: 'utterance-2' });
    await scheduler.drain();
    scheduler.onSnapshot(snapshot('corrected first', 2, true));
    await scheduler.drain();
    scheduler.onSnapshot({ ...snapshot('third', 1, true), captionId: 3, providerItemId: 'utterance-3' });
    await scheduler.drain();
    scheduler.close();
    expect(histories[2].map((turn) => turn.source)).toEqual(['second']);
    expect(histories[3].map((turn) => turn.source)).toEqual(['corrected first', 'second']);
  });

  it('does not reintroduce a correction older than the six recent context turns', async () => {
    const histories: Array<Array<{ source: string; translation: string }>> = [];
    const scheduler = new LiveTranslationScheduler({
      minIntervalMs: 0,
      runner: async (source, _direction, history) => { histories.push(history); return `Dịch: ${source}`; },
    });
    for (let captionId = 1; captionId <= 9; captionId++) {
      scheduler.onSnapshot({ ...snapshot(`sentence ${captionId}`, 1, true), captionId, providerItemId: `utterance-${captionId}` });
      await scheduler.drain();
    }
    scheduler.onSnapshot(snapshot('corrected old sentence', 2, true));
    await scheduler.drain();
    scheduler.onSnapshot({ ...snapshot('sentence 10', 1, true), captionId: 10, providerItemId: 'utterance-10' });
    await scheduler.drain();
    scheduler.close();
    expect(histories.at(-1)?.map((turn) => turn.source)).toEqual([4, 5, 6, 7, 8, 9].map((captionId) => `sentence ${captionId}`));
  });

  it('respects configurable historyTurns (0, 2, and runtime update)', async () => {
    const histories: Array<Array<{ source: string; translation: string }>> = [];
    const scheduler = new LiveTranslationScheduler({
      minIntervalMs: 0,
      historyTurns: 0,
      runner: async (source, _direction, history) => {
        histories.push(history);
        return `Dịch: ${source}`;
      },
    });

    scheduler.onSnapshot({ ...snapshot('turn 1', 1, true), captionId: 1, providerItemId: 'u-1' });
    await scheduler.drain();
    expect(histories[0]).toEqual([]);

    scheduler.onSnapshot({ ...snapshot('turn 2', 1, true), captionId: 2, providerItemId: 'u-2' });
    await scheduler.drain();
    expect(histories[1]).toEqual([]); // 0 history turns configured

    // Dynamically increase to 2 turns
    scheduler.setHistoryTurns(2);
    scheduler.onSnapshot({ ...snapshot('turn 3', 1, true), captionId: 3, providerItemId: 'u-3' });
    await scheduler.drain();
    expect(histories[2].map((t) => t.source)).toEqual(['turn 1', 'turn 2']);

    // Add turn 4: should only retain last 2 turns
    scheduler.onSnapshot({ ...snapshot('turn 4', 1, true), captionId: 4, providerItemId: 'u-4' });
    await scheduler.drain();
    expect(histories[3].map((t) => t.source)).toEqual(['turn 2', 'turn 3']);

    scheduler.close();
  });
});
