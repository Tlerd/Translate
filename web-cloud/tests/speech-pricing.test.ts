import { describe, expect, it } from 'vitest';
import {
  estimateSpeechUsd,
  pricingAsOf,
  speechModel,
  speechUsdPerMinute,
} from '@/shared/speech-pricing';

describe('speech pricing', () => {
  it('maps providers to billed models', () => {
    expect(speechModel('google-transcribe')).toBe('gemini-3.5-transcribe');
    expect(speechModel('google')).toBe('gemini-3.5-transcribe-live');
    expect(speechModel('soniox')).toBe('stt-rt-v5');
    expect(pricingAsOf).toBe('2026-10-10');
  });

  it('prices Gemini per audio minute', () => {
    expect(speechUsdPerMinute('google-transcribe', false)).toBe(0.005);
    expect(speechUsdPerMinute('google', false)).toBe(0.009);
    expect(estimateSpeechUsd('google-transcribe', false, 10 * 60_000)).toBe(0.05);
    expect(estimateSpeechUsd('google', true, 30_000)).toBe(0.0045);
  });

  it('prices Soniox by open stream time, higher when its translation is used', () => {
    expect(speechUsdPerMinute('soniox', false)).toBe(0.002);
    expect(speechUsdPerMinute('soniox', true)).toBe(0.003);
    expect(estimateSpeechUsd('soniox', false, 3_600_000)).toBe(0.12);
    expect(estimateSpeechUsd('soniox', true, 3_600_000)).toBe(0.18);
  });

  it('keeps self-hosted Nemotron free', () => {
    expect(speechUsdPerMinute('nemotron', false)).toBe(0);
    expect(estimateSpeechUsd('nemotron', false, 3_600_000)).toBe(0);
  });

  it('treats empty or invalid durations as free', () => {
    expect(estimateSpeechUsd('google', false, 0)).toBe(0);
    expect(estimateSpeechUsd('google', false, -5)).toBe(0);
    expect(estimateSpeechUsd('google', false, Number.NaN)).toBe(0);
  });
});
