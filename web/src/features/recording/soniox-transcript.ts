export interface SonioxToken {
  text: string;
  is_final?: boolean;
  start_ms?: number;
  end_ms?: number;
  translation_status?: 'original' | 'translation';
  language?: string;
}

export interface SonioxSnapshot {
  text: string;
  translation?: string;
  isFinal: boolean;
  providerItemId: string;
  revision: number;
  startMs?: number;
  endMs?: number;
}

/** Final tokens are append-only; provisional tokens replace the previous hypothesis. */
export class SonioxTranscript {
  private committedOriginal: SonioxToken[] = [];
  private interimOriginal: SonioxToken[] = [];
  private committedTranslation: SonioxToken[] = [];
  private interimTranslation: SonioxToken[] = [];
  private utterance = 0;
  private revision = 0;
  private emitted = false;

  constructor(private readonly connectionId: string) {}

  process(message: { tokens?: SonioxToken[]; finished?: boolean }): SonioxSnapshot[] {
    const snapshots: SonioxSnapshot[] = [];
    const emit = (final: boolean) => {
      const origTokens = final ? this.committedOriginal : [...this.committedOriginal, ...this.interimOriginal];
      const transTokens = final ? this.committedTranslation : [...this.committedTranslation, ...this.interimTranslation];
      const text = origTokens.map((token) => token.text).join('').trim();
      const translation = transTokens.length ? transTokens.map((token) => token.text).join('').trim() : undefined;
      if (!text && !translation && !this.emitted) return;
      const starts = origTokens.flatMap((token) => Number.isFinite(token.start_ms) ? [token.start_ms!] : []);
      const ends = origTokens.flatMap((token) => Number.isFinite(token.end_ms) ? [token.end_ms!] : []);
      snapshots.push({
        text,
        translation,
        isFinal: final && (!!text || !!translation),
        providerItemId: `${this.connectionId}-${this.utterance}`,
        revision: ++this.revision,
        startMs: starts.length ? Math.min(...starts) : undefined,
        endMs: ends.length ? Math.max(...ends) : undefined,
      });
      this.emitted = true;
    };
    const boundary = () => {
      emit(true);
      this.committedOriginal = [];
      this.interimOriginal = [];
      this.committedTranslation = [];
      this.interimTranslation = [];
      this.emitted = false;
      this.revision = 0;
      this.utterance++;
    };
    if (message.tokens) {
      this.interimOriginal = [];
      this.interimTranslation = [];
      for (const token of message.tokens) {
        if (token.text === '<fin>' || token.text === '<end>') { boundary(); continue; }
        if (typeof token.text !== 'string') continue;
        if (token.translation_status === 'translation') {
          if (token.is_final) this.committedTranslation.push(token);
          else this.interimTranslation.push(token);
        } else {
          if (token.is_final) this.committedOriginal.push(token);
          else this.interimOriginal.push(token);
        }
      }
      if (!message.finished) emit(false);
    }
    if (message.finished) boundary();
    return snapshots;
  }
}
