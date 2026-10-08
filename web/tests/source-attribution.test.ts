import { describe, expect, it } from 'vitest';
import { chooseSpeakerLabel, SourceActivityTracker, SOURCE_ACTIVE_LEVEL } from '@/features/recording/source-attribution';
import { displaySpeakerLabel, isAllowedSpeakerLabel, SOURCE_SPEAKER_LABELS } from '@/shared/transcription';

const LOUD = SOURCE_ACTIVE_LEVEL * 4;

function fill(tracker: SourceActivityTracker, fromMs: number, toMs: number, mic: number, display: number): void {
  for (let ms = fromMs; ms < toMs; ms += 100) tracker.record(ms, mic, display);
}

describe('SourceActivityTracker', () => {
  it('labels a range by the source that was active', () => {
    const tracker = new SourceActivityTracker();
    fill(tracker, 0, 3000, LOUD, 0);
    fill(tracker, 3000, 6000, 0, LOUD);
    expect(tracker.attribute(0, 2900)).toBe(SOURCE_SPEAKER_LABELS.mic);
    expect(tracker.attribute(3100, 5900)).toBe(SOURCE_SPEAKER_LABELS.display);
  });

  it('returns undefined when neither source reaches 65% of the activity', () => {
    const tracker = new SourceActivityTracker();
    fill(tracker, 0, 2000, LOUD, 0);
    fill(tracker, 2000, 4000, 0, LOUD);
    expect(tracker.attribute(0, 3900)).toBeUndefined();
  });

  it('keeps the dominant source when the other overlaps briefly', () => {
    const tracker = new SourceActivityTracker();
    fill(tracker, 0, 1000, LOUD, 0); // 10 mic ticks
    fill(tracker, 1000, 1300, LOUD, LOUD); // 3 shared ticks
    fill(tracker, 1300, 1800, LOUD, 0); // 5 mic ticks
    // mic = 18 ticks, display = 3 ticks -> 18/21 = 86% mic
    expect(tracker.attribute(0, 1700)).toBe(SOURCE_SPEAKER_LABELS.mic);
  });

  it('is undefined for silence, empty ranges and an empty tracker', () => {
    const tracker = new SourceActivityTracker();
    expect(tracker.attribute(0, 1000)).toBeUndefined();
    fill(tracker, 0, 2000, 0, 0);
    expect(tracker.attribute(0, 1900)).toBeUndefined();
    expect(tracker.attribute(500, 500)).toBeUndefined();
    expect(tracker.attribute(900, 100)).toBeUndefined();
  });

  it('ignores activity outside the requested range', () => {
    const tracker = new SourceActivityTracker();
    fill(tracker, 0, 2000, LOUD, 0);
    fill(tracker, 2000, 4000, 0, LOUD);
    expect(tracker.attribute(2100, 3900)).toBe(SOURCE_SPEAKER_LABELS.display);
  });

  it('treats a level just below the threshold as silent', () => {
    const tracker = new SourceActivityTracker();
    fill(tracker, 0, 1000, SOURCE_ACTIVE_LEVEL - 0.001, 0);
    expect(tracker.attribute(0, 900)).toBeUndefined();
  });
});

describe('source speaker labels', () => {
  it('are always allowed and have Vietnamese display names', () => {
    expect(isAllowedSpeakerLabel(SOURCE_SPEAKER_LABELS.mic, 1)).toBe(true);
    expect(isAllowedSpeakerLabel(SOURCE_SPEAKER_LABELS.display, 1)).toBe(true);
    expect(isAllowedSpeakerLabel('spk_3', 2)).toBe(false);
    expect(displaySpeakerLabel(SOURCE_SPEAKER_LABELS.mic)).toBe('Tôi');
    expect(displaySpeakerLabel(SOURCE_SPEAKER_LABELS.display)).toBe('Cuộc họp');
    expect(displaySpeakerLabel('spk_2')).toBe('Speaker 2');
  });
});

describe('chooseSpeakerLabel', () => {
  it('always calls the microphone the user, even over a provider speaker', () => {
    expect(chooseSpeakerLabel('spk_2', SOURCE_SPEAKER_LABELS.mic)).toBe(SOURCE_SPEAKER_LABELS.mic);
  });

  it('keeps provider diarization for meeting participants', () => {
    expect(chooseSpeakerLabel('spk_2', SOURCE_SPEAKER_LABELS.display)).toBe('spk_2');
    expect(chooseSpeakerLabel(undefined, SOURCE_SPEAKER_LABELS.display)).toBe(SOURCE_SPEAKER_LABELS.display);
  });

  it('falls back to the provider label when the source is unclear', () => {
    expect(chooseSpeakerLabel('spk_1', undefined)).toBe('spk_1');
    expect(chooseSpeakerLabel(undefined, undefined)).toBeUndefined();
  });
});
