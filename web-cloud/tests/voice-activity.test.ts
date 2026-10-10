import { describe, expect, it } from 'vitest';
import { AdaptiveVoiceDetector, MAX_VOICE_RMS, MIN_VOICE_RMS } from '@/features/recording/voice-activity';

describe('AdaptiveVoiceDetector', () => {
  it('treats quiet speech on a quiet microphone as voice', () => {
    const detector = new AdaptiveVoiceDetector();
    for (let i = 0; i < 50; i++) detector.isVoice(0.002);
    expect(detector.isVoice(0.009)).toBe(true);
  });

  it('never rises above the legacy fixed threshold in noisy rooms', () => {
    const detector = new AdaptiveVoiceDetector();
    for (let i = 0; i < 2000; i++) detector.isVoice(0.014);
    expect(detector.threshold).toBeLessThanOrEqual(MAX_VOICE_RMS);
    expect(detector.isVoice(0.016)).toBe(true);
  });

  it('does not learn sustained speech as noise', () => {
    const detector = new AdaptiveVoiceDetector();
    for (let i = 0; i < 50; i++) detector.isVoice(0.002);
    for (let i = 0; i < 500; i++) detector.isVoice(0.03);
    expect(detector.threshold).toBeLessThan(0.01);
  });

  it('rejects near-silence', () => {
    const detector = new AdaptiveVoiceDetector();
    expect(detector.isVoice(MIN_VOICE_RMS / 4)).toBe(false);
  });
});
