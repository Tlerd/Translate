import { speechModel } from '@/shared/speech-pricing';
import type { SpeechProvider } from '@/shared/transcription';

/** Reports billed speech-recognition time for cost estimates. It must never affect recording. */
export interface SpeechUsageReport {
  sessionId: string;
  recordingId: string;
  provider: SpeechProvider;
  model: string;
  translated: boolean;
  audioMs: number;
  startedAt: string;
  endedAt?: string;
}

export interface SpeechUsageKind {
  provider: SpeechProvider;
  translated: boolean;
}

export type SpeechUsageSender = (report: SpeechUsageReport, options: { keepalive: boolean }) => unknown;

export interface SpeechUsageReporterOptions {
  send?: SpeechUsageSender;
  now?: () => number;
  newSessionId?: () => string;
  intervalMs?: number;
  /** Receives `pagehide`; defaults to `window` when available. */
  pageTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

export const SPEECH_USAGE_FLUSH_MS = 60_000;
const ENDPOINT = '/api/usage/speech';

export function defaultSpeechUsageSender(report: SpeechUsageReport, options: { keepalive: boolean }): unknown {
  if (typeof fetch !== 'function') return undefined;
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: options.keepalive,
    cache: 'no-store',
  });
}

function randomSessionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Insecure contexts (plain http on a LAN) have no randomUUID.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Bucket {
  closedMs = 0;
  sentMs = -1;
  readonly open = new Map<number, number>();
  constructor(
    readonly sessionId: string,
    readonly provider: SpeechProvider,
    readonly translated: boolean,
    readonly startedAt: number,
  ) {}

  audioMs(now: number): number {
    let total = this.closedMs;
    for (const since of this.open.values()) total += Math.max(0, now - since);
    return Math.round(total);
  }
}

/**
 * Accumulates billed audio time per (provider, translated) within one recording
 * session and upserts it by sessionId. Live providers are billed for the time a
 * stream is open (`openStream`/`closeStream`); segment providers for the audio
 * actually sent (`addAudio`). `rollover` starts a new sessionId (pause/resume).
 */
export class SpeechUsageReporter {
  private readonly send: SpeechUsageSender;
  private readonly now: () => number;
  private readonly newSessionId: () => string;
  private readonly intervalMs: number;
  private readonly pageTarget: SpeechUsageReporterOptions['pageTarget'];
  private active = new Map<string, Bucket>();
  private retired = new Set<Bucket>();
  private streams = new Map<number, Bucket>();
  private nextStreamId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finished = false;
  private readonly onPageHide = () => this.flush({ keepalive: true });

  constructor(private readonly recordingId: string, options: SpeechUsageReporterOptions = {}) {
    this.send = options.send ?? defaultSpeechUsageSender;
    this.now = options.now ?? (() => Date.now());
    this.newSessionId = options.newSessionId ?? randomSessionId;
    this.intervalMs = options.intervalMs ?? SPEECH_USAGE_FLUSH_MS;
    this.pageTarget = options.pageTarget !== undefined
      ? options.pageTarget
      : typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
  }

  start(): void {
    if (this.timer || this.finished) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    try { this.pageTarget?.addEventListener('pagehide', this.onPageHide); } catch { /* optional */ }
  }

  /** Marks a live recognizer stream as open and billed. Returns an id for `closeStream`; 0 when ignored. */
  openStream(kind: SpeechUsageKind): number {
    if (this.finished) return 0;
    const bucket = this.bucketFor(kind);
    const id = this.nextStreamId++;
    bucket.open.set(id, this.now());
    this.streams.set(id, bucket);
    return id;
  }

  closeStream(id: number): void {
    const bucket = this.streams.get(id);
    if (!bucket) return;
    this.streams.delete(id);
    const since = bucket.open.get(id);
    bucket.open.delete(id);
    if (since !== undefined) bucket.closedMs += Math.max(0, this.now() - since);
  }

  /** Adds audio that was actually sent to a segment-based provider. */
  addAudio(kind: SpeechUsageKind, ms: number): void {
    if (this.finished || !Number.isFinite(ms) || ms <= 0) return;
    this.bucketFor(kind).closedMs += ms;
  }

  /** Ends the current sessionId (a pause/resume); the next audio opens a new one. */
  rollover(): void {
    if (this.finished) return;
    for (const bucket of this.active.values()) this.retired.add(bucket);
    this.active = new Map();
    this.flush();
  }

  flush(options: { keepalive?: boolean; final?: boolean } = {}): void {
    const now = this.now();
    const keepalive = options.keepalive === true;
    for (const bucket of [...this.active.values(), ...this.retired]) {
      const audioMs = bucket.audioMs(now);
      const ended = options.final === true || (this.retired.has(bucket) && bucket.open.size === 0);
      if (audioMs > 0 && (ended || audioMs !== bucket.sentMs)) {
        this.report({
          sessionId: bucket.sessionId,
          recordingId: this.recordingId,
          provider: bucket.provider,
          model: speechModel(bucket.provider),
          translated: bucket.translated,
          audioMs,
          startedAt: new Date(bucket.startedAt).toISOString(),
          ...(ended ? { endedAt: new Date(now).toISOString() } : {}),
        }, keepalive);
        bucket.sentMs = audioMs;
      }
      if (ended && bucket.open.size === 0) this.retired.delete(bucket);
    }
  }

  /** Sends the final reports and stops all timers. Does not wait for the network. */
  finish(): void {
    if (this.finished) return;
    this.flush({ final: true });
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.pageTarget?.removeEventListener('pagehide', this.onPageHide); } catch { /* optional */ }
    this.active.clear();
    this.retired.clear();
    this.streams.clear();
  }

  private bucketFor(kind: SpeechUsageKind): Bucket {
    const translated = kind.translated === true;
    const key = `${kind.provider}|${translated}`;
    let bucket = this.active.get(key);
    if (!bucket) {
      bucket = new Bucket(this.newSessionId(), kind.provider, translated, this.now());
      this.active.set(key, bucket);
    }
    return bucket;
  }

  private report(report: SpeechUsageReport, keepalive: boolean): void {
    try {
      const result = this.send(report, { keepalive }) as { catch?: (handler: () => void) => unknown } | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // Usage reporting is best effort and must never reach the recording flow.
    }
  }
}
