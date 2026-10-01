import { describe, expect, it } from 'vitest';
import { diarizedTranscriptTurns, type DiarizedWordSegment } from '@/server/ai/gemini-diarize';

describe('native speaker turn extraction', () => {
  const word = (text: string, speakerLabel: string, startMs: number): DiarizedWordSegment => ({ text, speakerLabel, startMs, endMs: startMs + 100 });

  it('preserves filler words, repetitions, and punctuation instead of rebuilding text from tokens', () => {
    const turns = diarizedTranscriptTurns('Um, hello, hello! Yes.', [word('Um', 'spk_1', 0), word('hello', 'spk_1', 100), word('hello', 'spk_1', 200), word('Yes', 'spk_2', 500)], 2);
    expect(turns).toEqual([
      { text: 'Um, hello, hello!', speakerLabel: 'spk_1', startMs: 0, endMs: 300 },
      { text: 'Yes.', speakerLabel: 'spk_2', startMs: 500, endMs: 600 },
    ]);
  });

  it('preserves Japanese without injecting spaces between words', () => {
    expect(diarizedTranscriptTurns('えっと、こんにちは。はい。', [word('えっと', 'spk_1', 0), word('こんにちは', 'spk_1', 100), word('はい', 'spk_2', 500)], 2).map(turn => turn.text)).toEqual(['えっと、こんにちは。', 'はい。']);
  });

  it('keeps returning source text when a detected speaker exceeds the configured roster', () => {
    expect(diarizedTranscriptTurns('Hello. Hi.', [word('Hello', 'spk_1', 0), word('Hi', 'spk_2', 500)], 1)).toEqual([
      { text: 'Hello.', speakerLabel: 'spk_1', startMs: 0, endMs: 100 },
      { text: 'Hi.', startMs: 500, endMs: 600 },
    ]);
  });

  it('supports Speaker 8 and does not collapse returning speakers into a single turn', () => {
    expect(diarizedTranscriptTurns('One. Eight. One.', [word('One', 'spk_1', 0), word('Eight', 'spk_8', 200), word('One', 'spk_1', 400)], 8).map(turn => turn.speakerLabel)).toEqual(['spk_1', 'spk_8', 'spk_1']);
  });

  it('leaves an inconsistent or missing annotation result for the intact-text fallback', () => {
    expect(diarizedTranscriptTurns('Actual transcript.', [word('Other', 'spk_1', 0)], 1)).toEqual([]);
    expect(diarizedTranscriptTurns('Actual transcript.', [], 1)).toEqual([]);
  });
});
