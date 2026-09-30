import { describe, it, expect, vi } from 'vitest';
import {
  LiveUtteranceAssembler,
  type TranscriptSnapshot,
} from '@/features/recording/utterance-assembler';
import {
  LiveTranslationScheduler,
  type ScheduledTranslationEvent,
} from '@/features/recording/translation-scheduler';

describe('LiveUtteranceAssembler', () => {
  it('combines text correctly for Japanese (no space) and English/Vietnamese (with space)', () => {
    expect(LiveUtteranceAssembler.combine('こんにちは', '世界')).toBe('こんにちは世界');
    expect(LiveUtteranceAssembler.combine('Hello', 'world')).toBe('Hello world');
    expect(LiveUtteranceAssembler.combine('Xin', 'chào')).toBe('Xin chào');
  });

  it('handles lecture mode passing through each final sentence as new captionId', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((s) => emissions.push(s));

    // Interim
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: 'こんにちは',
      isFinal: false,
      startMs: 0,
      endMs: 1000,
    });

    // Final
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 2,
      text: 'こんにちは。',
      isFinal: true,
      startMs: 0,
      endMs: 1200,
    });

    expect(emissions.length).toBe(2);
    expect(assembler.currentCaptionId).toBe(2);
  });

  it('finalizes an in-progress lecture snapshot when the session stops', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((snapshot) => emissions.push(snapshot));
    assembler.handleSnapshot({
      connectionEpoch: 1, providerItemId: 'speech-1', blockId: 1, captionId: 1,
      revision: 1, text: 'unfinished phrase', isFinal: false, startMs: 0, endMs: 500,
    });
    assembler.finalizeCurrentUtterance(true);
    expect(emissions.map((snapshot) => [snapshot.text, snapshot.isFinal, snapshot.revision])).toEqual([
      ['unfinished phrase', false, 1],
      ['unfinished phrase', true, 2],
    ]);
  });

  it('accepts a late lecture final without replacing a newer in-progress sentence', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((snapshot) => emissions.push(snapshot));
    assembler.handleSnapshot({
      connectionEpoch: 1, providerItemId: 'speech-a', blockId: 1, captionId: 1,
      revision: 1, text: 'old rough text', isFinal: false, startMs: 0, endMs: 400,
    });
    assembler.handleBlockClosed(1);
    assembler.handleSnapshot({
      connectionEpoch: 1, providerItemId: 'speech-b', blockId: 2, captionId: 2,
      revision: 1, text: 'new in progress', isFinal: false, startMs: 600, endMs: 900,
    });
    assembler.handleSnapshot({
      connectionEpoch: 1, providerItemId: 'speech-a', blockId: 1, captionId: 1,
      revision: 2, text: 'old final text', isFinal: true, startMs: 0, endMs: 450,
    });
    assembler.finalizeCurrentUtterance(true);
    expect(emissions.at(-2)).toMatchObject({ captionId: 1, text: 'old final text', isFinal: true });
    expect(emissions.at(-1)).toMatchObject({ captionId: 2, text: 'new in progress', isFinal: true });
  });

  it('handles readingPractice mode merging short pause chunks into one sentence', () => {
    const assembler = new LiveUtteranceAssembler('readingPractice');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((s) => emissions.push(s));

    // First chunk finished (user paused for 1 second)
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: '私は',
      isFinal: true,
      startMs: 0,
      endMs: 800,
    });

    // In readingPractice mode, emission is marked isFinal=false so sentence can continue!
    expect(emissions[0].text).toBe('私は');
    expect(emissions[0].isFinal).toBe(false);
    expect(assembler.currentCaptionId).toBe(1);

    // Second chunk spoken after short pause
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-2',
      blockId: 1,
      captionId: 1,
      revision: 2,
      text: '学生です。',
      isFinal: true,
      startMs: 1200,
      endMs: 2000,
    });

    expect(emissions[1].text).toBe('私は学生です。');
    expect(emissions[1].isFinal).toBe(false);

    // Finalize on block close (e.g. 10s silence)
    assembler.finalizeCurrentUtterance(true);
    const lastEmission = emissions[emissions.length - 1];
    expect(lastEmission.text).toBe('私は学生です。');
    expect(lastEmission.isFinal).toBe(true);
    expect(assembler.currentCaptionId).toBe(2);
  });

  it('replaces a late finalized reading span without duplicating or changing the next row', () => {
    const assembler = new LiveUtteranceAssembler('readingPractice');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((snapshot) => emissions.push(snapshot));
    const base: TranscriptSnapshot = {
      connectionEpoch: 1, providerItemId: 'part-1', blockId: 1, captionId: 1,
      revision: 1, text: 'きょうは', isFinal: true, startMs: 0, endMs: 400,
    };
    assembler.handleSnapshot(base);
    assembler.handleSnapshot({ ...base, providerItemId: 'part-2', text: '良い天気', startMs: 500, endMs: 900 });
    assembler.finalizeCurrentUtterance(true);
    expect(assembler.currentCaptionId).toBe(2);

    assembler.handleSnapshot({ ...base, providerItemId: 'next', captionId: 2, blockId: 2, text: 'next sentence', isFinal: false, startMs: 1000, endMs: 1300 });
    assembler.handleSnapshot({ ...base, providerItemId: 'part-1', text: '今日は', revision: 2, endMs: 450 });

    expect(emissions.at(-1)).toMatchObject({ captionId: 1, text: '今日は良い天気', isFinal: true });
    expect(assembler.currentCaptionId).toBe(2);
    expect(assembler.currentText).toBe('next sentence');
    assembler.finalizeCurrentUtterance(true);
    expect(emissions.at(-1)).toMatchObject({ captionId: 2, text: 'next sentence', isFinal: true });
  });
});

describe('LiveTranslationScheduler', () => {
  it('keeps every finalized caption queued while a prior translation is running', async () => {
    const calls: string[] = [];
    const releases: Array<(value: string) => void> = [];
    const scheduler = new LiveTranslationScheduler({
      runner: (source) => {
        calls.push(source);
        return new Promise<string>((resolve) => releases.push(resolve));
      },
      minIntervalMs: 0,
      maxAgeMs: 10_000,
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    const snapshot = (captionId: number, text: string): TranscriptSnapshot => ({
      connectionEpoch: 1,
      providerItemId: `p-${captionId}`,
      blockId: 1,
      captionId,
      revision: 1,
      text,
      isFinal: true,
      startMs: captionId * 100,
      endMs: captionId * 100 + 50,
    });

    scheduler.onSnapshot(snapshot(1, 'one.'));
    scheduler.onSnapshot(snapshot(2, 'two.'));
    scheduler.onSnapshot(snapshot(3, 'three.'));
    expect(calls).toEqual(['one.']);

    releases.shift()!('uno');
    await vi.waitFor(() => expect(calls).toEqual(['one.', 'two.']));
    releases.shift()!('dos');
    await vi.waitFor(() => expect(calls).toEqual(['one.', 'two.', 'three.']));
    releases.shift()!('tres');
    await vi.waitFor(() => expect(events.filter((event) => event.isFinal && event.targetText).map((event) => event.captionId)).toEqual([1, 2, 3]));
    scheduler.close();
  });

  it('reports failed translations with their partial text and never marks them final', async () => {
    const scheduler = new LiveTranslationScheduler({
      runner: async function* () {
        yield 'partial';
        throw new Error('provider failed');
      },
      minIntervalMs: 0,
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 1, text: 'hello', isFinal: true, startMs: 0, endMs: 100,
    });

    await vi.waitFor(() => expect(events.some((event) => event.error)).toBe(true));
    const failure = events.find((event) => event.error)!;
    expect(failure.targetText).toBe('partial');
    expect(failure.isFinal).toBe(false);
    scheduler.close();
  });

  it('emits target deltas while the provider request is still open', async () => {
    let release!: (value: string) => void;
    const scheduler = new LiveTranslationScheduler({
      runner: (_source, _direction, _history, _signal, _snapshot, onDelta) => {
        onDelta?.('live');
        return new Promise<string>((resolve) => { release = resolve; });
      },
      minIntervalMs: 0,
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 1, text: 'source text', isFinal: true, startMs: 0, endMs: 100,
    });
    expect(events[0]).toMatchObject({ sourceText: 'source text', isFinal: true });
    expect(events.some((event) => event.targetText === 'live')).toBe(true);
    release('live translation');
    await scheduler.drain();
    scheduler.close();
  });

  it('promotes a reused interim translation to the final source revision', async () => {
    const scheduler = new LiveTranslationScheduler({
      runner: async (source) => `Dịch: ${source}`,
      minIntervalMs: 0,
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    const base: TranscriptSnapshot = {
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 1, text: 'こんにちは', isFinal: false, startMs: 0, endMs: 100,
    };
    scheduler.onSnapshot(base);
    await scheduler.drain();
    scheduler.onSnapshot({ ...base, revision: 2, text: 'こんにちは。', isFinal: true });
    expect(events.at(-1)).toMatchObject({
      targetText: 'Dịch: こんにちは', sourceRevision: 2, targetSourceRevision: 2,
      isFinal: true, isProvisional: false,
    });
    scheduler.close();
  });

  it('accepts a late final transcript update for a caption whose silence block already closed', async () => {
    const scheduler = new LiveTranslationScheduler({ runner: async (source) => `Dịch: ${source}`, minIntervalMs: 0 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 1, text: 'rough source', isFinal: false, startMs: 0, endMs: 100,
    });
    await scheduler.drain();
    scheduler.onBlockClosed(1);
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 2, text: 'final source', isFinal: true, startMs: 0, endMs: 120,
    });
    await scheduler.drain();
    expect(events.at(-1)).toMatchObject({ sourceText: 'final source', targetText: 'Dịch: final source', isFinal: true });
    expect(events.some((event) => event.skipReason === 'closed')).toBe(false);
    scheduler.close();
  });

  it('resolves drain after the only pending interim expires while the active request finishes', async () => {
    let release!: (value: string) => void;
    const runner = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0, maxAgeMs: 10 });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-1', blockId: 1, captionId: 1,
      revision: 1, text: 'active', isFinal: true, startMs: 0, endMs: 100,
    });
    scheduler.onSnapshot({
      connectionEpoch: 1, providerItemId: 'p-2', blockId: 1, captionId: 2,
      revision: 1, text: 'expired interim', isFinal: false, startMs: 100, endMs: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const drained = scheduler.drain();
    release('active translation');
    await expect(drained).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledOnce();
    expect(events.some((event) => event.captionId === 2 && event.skipReason === 'stale')).toBe(true);
    scheduler.close();
  });

  it('tracks 500 sequential final caption snapshots', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    let emittedCount = 0;
    assembler.subscribe(() => {
      emittedCount++;
    });

    // Feed 500 consecutive final sentences and assert the assembler preserves order/count.
    for (let i = 1; i <= 500; i++) {
      const startMs = (i - 1) * 7200;
      const endMs = startMs + 4000;
      assembler.handleSnapshot({
        connectionEpoch: 1,
        providerItemId: `p-${i}`,
        blockId: Math.floor(i / 10) + 1,
        captionId: i,
        revision: 1,
        text: `Câu phát biểu thứ ${i} trong bài giảng kéo dài 60 phút.`,
        isFinal: true,
        startMs,
        endMs,
      });
    }

    expect(emittedCount).toBe(500);
    expect(assembler.currentCaptionId).toBe(501);
  });
});
