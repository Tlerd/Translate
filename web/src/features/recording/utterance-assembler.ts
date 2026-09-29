import type { ClassroomMode } from '@/shared/recording';

export interface TranscriptSnapshot {
  connectionEpoch: number;
  providerItemId: string;
  blockId: number;
  captionId: number;
  revision: number;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
}

export type SnapshotListener = (snapshot: TranscriptSnapshot) => void;

/**
 * Assembles speech tokens and technical spans into coherent sentence units.
 * Ports the logic from app/lib/live_utterance_assembler.dart:
 * - In lecture mode, pass-through with sentence boundary tracking.
 * - In readingPractice mode, prevents 1-3 second pauses from fragmenting
 *   sentences into multiple separate rows.
 */
export class LiveUtteranceAssembler {
  public mode: ClassroomMode;

  private listeners: Set<SnapshotListener> = new Set();
  private captionCounter = 1;
  private currentRevision = 0;
  private assembledConfirmedText = '';
  private activeInterimText = '';
  private activeBlockId = 1;
  private activeStartMs = 0;
  private activeEndMs = 0;
  private connectionEpoch = 1;
  private providerItemId = 'assembled-1';
  private closed = false;

  constructor(mode: ClassroomMode = 'lecture') {
    this.mode = mode;
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(snapshot: TranscriptSnapshot): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('Error in SnapshotListener:', err);
      }
    }
  }

  public get currentCaptionId(): number {
    return this.captionCounter;
  }

  public get currentText(): string {
    return LiveUtteranceAssembler.combine(this.assembledConfirmedText, this.activeInterimText);
  }

  public static isCjk(text: string): boolean {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f]/.test(text);
  }

  public static combine(prefix: string, suffix: string): string {
    const p = prefix.trim();
    const s = suffix.trim();
    if (!p) return s;
    if (!s) return p;
    if (LiveUtteranceAssembler.isCjk(p) || LiveUtteranceAssembler.isCjk(s)) {
      return `${p}${s}`;
    }
    return `${p} ${s}`;
  }

  public handleSnapshot(snapshot: TranscriptSnapshot): void {
    if (this.closed) return;
    this.connectionEpoch = snapshot.connectionEpoch;
    this.providerItemId = snapshot.providerItemId;

    if (this.mode === 'lecture') {
      // In lecture mode, pass-through with sentence boundary tracking
      this.activeBlockId = snapshot.blockId;
      this.emit(snapshot);
      if (snapshot.isFinal) {
        this.captionCounter = snapshot.captionId + 1;
      }
      return;
    }

    // --- Reading Practice Mode ---
    if (this.activeStartMs === 0 && snapshot.startMs > 0) {
      this.activeStartMs = snapshot.startMs;
    }
    this.activeEndMs = snapshot.endMs;
    this.activeBlockId = snapshot.blockId;

    if (!snapshot.isFinal) {
      // Interim hypothesis
      this.activeInterimText = snapshot.text;
      this.currentRevision++;
      const fullText = LiveUtteranceAssembler.combine(
        this.assembledConfirmedText,
        this.activeInterimText
      );
      this.emit({
        connectionEpoch: this.connectionEpoch,
        providerItemId: `reading-${this.captionCounter}`,
        blockId: this.activeBlockId,
        captionId: this.captionCounter,
        revision: this.currentRevision,
        text: fullText,
        isFinal: false,
        startMs: this.activeStartMs,
        endMs: this.activeEndMs,
      });
    } else {
      // ASR final for a chunk/span (e.g. user paused for 1-2 seconds)
      // In Reading Practice mode, we append this chunk to current sentence
      // rather than ending the caption row.
      this.assembledConfirmedText = LiveUtteranceAssembler.combine(
        this.assembledConfirmedText,
        snapshot.text
      );
      this.activeInterimText = '';
      this.currentRevision++;

      this.emit({
        connectionEpoch: this.connectionEpoch,
        providerItemId: this.providerItemId,
        blockId: this.activeBlockId,
        captionId: this.captionCounter,
        revision: this.currentRevision,
        text: this.assembledConfirmedText,
        // Mark as non-final in UI/scheduler so user can continue reading the sentence!
        isFinal: false,
        startMs: this.activeStartMs,
        endMs: this.activeEndMs,
      });
    }
  }

  /**
   * Called when 10s silence closes block or session finishes.
   */
  public finalizeCurrentUtterance(advanceCaption = true): void {
    if (this.closed || !this.assembledConfirmedText.trim()) return;

    const fullText = LiveUtteranceAssembler.combine(
      this.assembledConfirmedText,
      this.activeInterimText
    );
    this.currentRevision++;
    this.emit({
      connectionEpoch: this.connectionEpoch,
      providerItemId: this.providerItemId,
      blockId: this.activeBlockId,
      captionId: this.captionCounter,
      revision: this.currentRevision,
      text: fullText,
      isFinal: true,
      startMs: this.activeStartMs,
      endMs: this.activeEndMs,
    });

    if (advanceCaption) {
      this.captionCounter++;
      this.assembledConfirmedText = '';
      this.activeInterimText = '';
      this.activeStartMs = 0;
      this.activeEndMs = 0;
    }
  }

  public handleBlockClosed(blockId: number): void {
    if (this.mode === 'readingPractice') {
      this.finalizeCurrentUtterance(true);
    }
    this.activeBlockId = blockId + 1;
  }

  public switchMode(newMode: ClassroomMode): void {
    if (this.mode === newMode) return;
    if (this.mode === 'readingPractice') {
      this.finalizeCurrentUtterance(true);
    }
    this.mode = newMode;
  }

  public close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}
