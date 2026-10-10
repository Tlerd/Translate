import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { LiveTranslationScheduler, type ContextTurn } from '@/features/recording/translation-scheduler';
import * as segmenter from '@/features/recording/stable-segmenter';
import { buildTranslationPayloadWithStats, buildTranslationSystemPrompt } from '@/server/ai/prompts/translation';
import quality from './fixtures/translation-quality.json';

// Fixed baseline, not the moving HEAD: reruns compare the same implementation.
const baselineCommit = '9690936';
const baselineSource = readFileSync(path.join(__dirname, 'fixtures/translation-scheduler-9690936.txt'), 'utf8');
const baselineExports: { LiveTranslationScheduler?: typeof LiveTranslationScheduler } = {};
const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'exports', compiled)(() => segmenter, baselineExports);
const Baseline = baselineExports.LiveTranslationScheduler!;

afterEach(() => vi.useRealTimers());

describe('synthetic ASR replay (request/character measurements, not token estimates)', () => {
  it('validates the draft quality corpus covers both directions and 48 meaning rubrics', () => {
    const cases = quality.groups.flatMap((group) => group.cases);
    expect(cases).toHaveLength(48);
    expect(quality.groups.some((group) => group.sourceLanguage === 'vi')).toBe(true);
    expect(cases.every((row) => typeof row[0] === 'string' && typeof row[1] === 'string' && row[1].length > 10)).toBe(true);
  });

  it('replays identical snapshots against baseline/current for N=0/2/6 and early off/on', async () => {
    vi.useFakeTimers();
    const report: unknown[] = [];
    for (const [version, Scheduler] of [['baseline', Baseline], ['current', LiveTranslationScheduler]] as const) {
      for (const n of [0, 2, 6]) {
        for (const early of [false, true]) {
          const calls: Array<{ source: string; history: ContextTurn[]; kind?: string; systemChars: number; payloadChars: number; actualHistoryTurns: number }> = [];
          const scheduler = new Scheduler({ minIntervalMs: 0, historyTurns: n, earlySegments: early,
            runner: async (source, _direction, history, _signal, _snapshot, _delta, kind) => {
              const built = buildTranslationPayloadWithStats({ sourceLanguage: 'ja', targetLanguage: 'vi', currentUtterance: source, previousTurns: history });
              calls.push({ source, history, kind, systemChars: buildTranslationSystemPrompt('ja', 'vi').length,
                payloadChars: built.payload.length, actualHistoryTurns: built.historyTurns });
              return `D:${source}`;
            } });
          const send = (captionId: number, revision: number, text: string, isFinal: boolean) => scheduler.onSnapshot({
            captionId, revision, text, isFinal, blockId: 1, connectionEpoch: 1, providerItemId: `${captionId}`,
            startMs: 0, endMs: Date.now() });
          for (let revision = 1; revision <= 8; revision++) {
            send(1, revision, `まだ話している途中${revision}`, false);
            await vi.advanceTimersByTimeAsync(800);
          }
          expect(calls).toHaveLength(0);
          send(1, 9, '今日の授業について説明します。', true);
          await scheduler.drain();
          const prefix = 'こんにちは、本日はよろしくお願いします。';
          send(2, 1, prefix, false);
          await vi.advanceTimersByTimeAsync(1600);
          send(2, 2, prefix + '午後から雨が降るそうです。', true);
          await scheduler.drain();
          send(3, 1, '明日は全員が授業に参加することができます。', false);
          await vi.advanceTimersByTimeAsync(1600);
          send(3, 2, '明日は全員が授業に参加することができません。', true);
          await scheduler.drain();
          send(4, 1, '次は来週です', true);
          await scheduler.drain();
          send(4, 2, '次は来週です。', true);
          await scheduler.drain();
          scheduler.close();
          expect(calls).toHaveLength(early ? 6 : 4);
          if (version === 'current') expect(calls.every((call) => call.history.length <= n)).toBe(true);
          report.push({ version, baselineCommit, historyLimit: n, early, requests: calls.length,
            inputTokens: null, outputTokens: null, estimatedUsd: null,
            inputCharacters: calls.reduce((sum, call) => sum + call.systemChars + call.payloadChars, 0), calls });
        }
      }
    }
    if (process.env.TRANSLATION_REPLAY_REPORT) {
      const destination = path.resolve(process.env.TRANSLATION_REPLAY_REPORT);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, JSON.stringify({ measurement: 'mock requests and characters; synthetic text; same v2 prompt for both schedulers', rows: report }, null, 2));
    }
  });
});
