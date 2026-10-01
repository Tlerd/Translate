import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiTranscribeRecognizer, pcmWav } from '@/features/recording/gemini-transcribe-recognition';
import type { SpeakerCount, TranscriptionMode } from '@/shared/transcription';

function setup(mode: TranscriptionMode = 'verbatim', speakerCount: SpeakerCount = 1) {
  const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
  const recognizer = new GeminiTranscribeRecognizer(callbacks, 'ja-JP', 900, mode, speakerCount);
  recognizer.start(7);
  return { recognizer, callbacks };
}
afterEach(() => vi.unstubAllGlobals());

describe('unary Gemini transcription', () => {
  it('drains the final audio on stop, with a valid independent WAV and original timestamps', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'こんにちは' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(callbacks.onTranscript).toHaveBeenCalledWith('こんにちは', true, 7, 'transcribe_7_1', 1, { startMs: 0, endMs: 500 });
    const form = fetcher.mock.calls[0][1].body as FormData;
    const audio = form.get('audio') as File;
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBe(16044);
    expect(form.get('durationMs')).toBe('500');
    expect(form.get('language')).toBe('ja-JP');
    expect(form.get('transcriptionMode')).toBe('verbatim');
    expect(form.get('speakerCount')).toBe('1');
  });

  it('emits native speaker turns with recording-relative timestamps across consecutive chunks', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ text: 'One. Two.', turns: [
      { text: 'One.', speakerLabel: 'spk_1', startMs: 100, endMs: 300 },
      { text: 'Two.', speakerLabel: 'spk_2', startMs: 600, endMs: 800 },
    ] }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup('verbatim', 2);
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000); recognizer.finalizeUtterance();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000);
    await recognizer.stop();
    // The streaming resampler retains one boundary sample until the next chunk.
    expect(callbacks.onTranscript.mock.calls.map(call => [call[0], { ...call[5], startMs: Math.round(call[5].startMs), endMs: Math.round(call[5].endMs) }])).toEqual([
      ['One.', { startMs: 100, endMs: 300, speakerLabel: 'spk_1' }],
      ['Two.', { startMs: 600, endMs: 800, speakerLabel: 'spk_2' }],
      ['One.', { startMs: 1100, endMs: 1300, speakerLabel: 'spk_1' }],
      ['Two.', { startMs: 1600, endMs: 1800, speakerLabel: 'spk_2' }],
    ]);
    expect(new Set(callbacks.onTranscript.mock.calls.map(call => call[3])).size).toBe(4);
  });

  it('keeps smart text intact and unlabelled even if a response contains stray speaker annotations', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'Clean text.', turns: [{ text: 'Wrong replacement', speakerLabel: 'spk_1', startMs: 0, endMs: 100 }] }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup('smart', 8);
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(callbacks.onTranscript).toHaveBeenCalledWith('Clean text.', true, 7, 'transcribe_7_1', 1, { startMs: 0, endMs: 500 });
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get('transcriptionMode')).toBe('smart');
    expect(form.get('speakerCount')).toBe('8');
  });

  it('finishes existing audio with its original mode and applies saved settings to the next segment', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ text: 'words' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    recognizer.updateSettings({ transcriptionMode: 'smart', speakerCount: 4 });
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(fetcher.mock.calls.map(call => [(call[1].body as FormData).get('transcriptionMode'), (call[1].body as FormData).get('speakerCount')])).toEqual([['verbatim', '1'], ['smart', '4']]);
  });

  it('keeps segments ordered even while earlier requests are pending, without replacing previous text', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
      .mockResolvedValueOnce(Response.json({ text: 'second' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000); recognizer.finalizeUtterance();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000);
    const stopped = recognizer.stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ text: 'first' })); await stopped;
    expect(callbacks.onTranscript.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(callbacks.onTranscript.mock.calls.map(call => call[3])).toEqual(['transcribe_7_1', 'transcribe_7_2']);
  });

  it('cuts after the configured short pause and surfaces API failure instead of returning success text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'quota' } }, { status: 429 })));
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    recognizer.pushPcm(new Float32Array(15000), 16000);
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled());
    await recognizer.stop();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onError.mock.calls[0][0]).toContain('quota');
  });

  it('encodes clipped little endian PCM16 at 16 kHz mono', async () => {
    const bytes = new DataView(await pcmWav(new Float32Array([-2, 0, 2])).arrayBuffer());
    expect(bytes.getUint32(24, true)).toBe(16000);
    expect(bytes.getUint16(22, true)).toBe(1);
    expect(bytes.getInt16(44, true)).toBe(-32768);
    expect(bytes.getInt16(48, true)).toBe(32767);
  });
});
