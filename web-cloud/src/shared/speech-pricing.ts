import { LIVE_TRANSCRIPTION_MODEL, TRANSCRIPTION_MODEL, type SpeechProvider } from './transcription';
import { SONIOX_MODEL } from './soniox';

/**
 * Speech recognition streams straight from the browser to the provider, so the
 * app can only estimate its cost from billed audio time. These are estimates,
 * not invoices.
 *
 * Source: provider price lists checked on the date below. Gemini bills audio
 * input tokens (about 0.005 / 0.009 USD per audio minute for Transcribe / Translate
 * Live); Soniox bills the time a stream is open (0.12 USD/hour, 0.18 USD/hour when
 * its translation is used); Nemotron is self-hosted, so only time is tracked.
 */
export const SPEECH_PRICING_AS_OF = '2026-10-10';
export const pricingAsOf = SPEECH_PRICING_AS_OF;

export const NEMOTRON_SPEECH_MODEL = 'nemotron-3.5-asr-streaming';

export const SPEECH_USAGE_MAX_AUDIO_MS = 6 * 60 * 60 * 1000;

export const SPEECH_PROVIDER_IDS = ['google-transcribe', 'google', 'soniox', 'nemotron'] as const satisfies readonly SpeechProvider[];

export function speechModel(provider: SpeechProvider): string {
  switch (provider) {
    case 'google-transcribe': return TRANSCRIPTION_MODEL;
    case 'google': return LIVE_TRANSCRIPTION_MODEL;
    case 'soniox': return SONIOX_MODEL;
    case 'nemotron': return NEMOTRON_SPEECH_MODEL;
  }
}

/** Estimated USD per audio minute. `translated` only matters for Soniox. */
export function speechUsdPerMinute(provider: SpeechProvider, translated: boolean): number {
  switch (provider) {
    case 'google-transcribe': return 0.005;
    case 'google': return 0.009;
    case 'soniox': return translated ? 0.003 : 0.002;
    case 'nemotron': return 0;
  }
}

export function estimateSpeechUsd(provider: SpeechProvider, translated: boolean, audioMs: number): number {
  if (!Number.isFinite(audioMs) || audioMs <= 0) return 0;
  return roundUsd((audioMs / 60_000) * speechUsdPerMinute(provider, translated));
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
