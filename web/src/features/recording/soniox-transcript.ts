export interface SonioxToken {
  text: string;
  is_final?: boolean;
  start_ms?: number;
  end_ms?: number;
}

export interface SonioxSnapshot {
  text: string;
  isFinal: boolean;
  providerItemId: string;
  revision: number;
  startMs?: number;
  endMs?: number;
}

/** Final tokens are append-only; provisional tokens replace the previous hypothesis. */
export class SonioxTranscript {
  private committed: SonioxToken[] = [];
  private interim: SonioxToken[] = [];
  private utterance = 0;
  private revision = 0;
  private emitted = false;

  constructor(private readonly connectionId: string) {}

  process(message: { tokens?: SonioxToken[]; finished?: boolean }): SonioxSnapshot[] {
    const snapshots: SonioxSnapshot[] = [];
    const emit = (final: boolean) => {
      const tokens = final ? this.committed : [...this.committed, ...this.interim];
      const text = tokens.map((token) => token.text).join('').trim();
      if (!text && !this.emitted) return;
      const starts = tokens.flatMap((token) => Number.isFinite(token.start_ms) ? [token.start_ms!] : []);
      const ends = tokens.flatMap((token) => Number.isFinite(token.end_ms) ? [token.end_ms!] : []);
      snapshots.push({ text, isFinal: final && !!text, providerItemId: `${this.connectionId}-${this.utterance}`,
        revision: ++this.revision, startMs: starts.length ? Math.min(...starts) : undefined,
        endMs: ends.length ? Math.max(...ends) : undefined });
      this.emitted = true;
    };
    const boundary = () => {
      emit(true);
      this.committed = []; this.interim = []; this.emitted = false;
      this.revision = 0; this.utterance++;
    };
    if (message.tokens) {
      this.interim = [];
      for (const token of message.tokens) {
        if (token.text === '<fin>' || token.text === '<end>') { boundary(); continue; }
        if (typeof token.text !== 'string') continue;
        if (token.is_final) this.committed.push(token);
        else this.interim.push(token);
      }
      if (!message.finished) emit(false);
    }
    if (message.finished) boundary();
    return snapshots;
  }
}
