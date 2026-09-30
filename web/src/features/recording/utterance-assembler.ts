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

interface ReadingPart {
  providerItemId: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface FinalizedReadingCaption {
  captionId: number;
  blockId: number;
  parts: ReadingPart[];
  revision: number;
  startMs: number;
  endMs: number;
}

/**
 * Assembles speech tokens and technical spans into coherent sentence units.
 * Ports the logic from app/lib/live_utterance_assembler.dart:
 * - In lecture mode, pass-through with sentence boundary tracking.
 * - In readingPractice mode, merges recognition spans until the configured
 *   silence boundary and applies delayed ASR corrections to their original row.
 */
export class LiveUtteranceAssembler {
  public mode: ClassroomMode;

  private listeners: Set<SnapshotListener> = new Set();
  private captionCounter = 1;
  private currentRevision = 0;
  private readingParts: ReadingPart[] = [];
  private finalizedReadingCaptions = new Map<number, FinalizedReadingCaption>();
  private activeBlockId = 1;
  private activeStartMs = 0;
  private activeEndMs = 0;
  private connectionEpoch = 1;
  private providerItemId = 'assembled-1';
  private latestLectureSnapshot: TranscriptSnapshot | null = null;
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
    return this.combineReadingParts(this.readingParts);
  }

  private combineReadingParts(parts: ReadingPart[]): string {
    return parts.reduce(
      (text, part) => LiveUtteranceAssembler.combine(text, part.text),
      ''
    );
  }

  private upsertReadingPart(parts: ReadingPart[], snapshot: TranscriptSnapshot): ReadingPart[] {
    const nextPart: ReadingPart = {
      providerItemId: snapshot.providerItemId,
      text: snapshot.text,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
    };
    const index = parts.findIndex((part) => part.providerItemId === snapshot.providerItemId);
    if (index >= 0) {
      const next = [...parts];
      next[index] = nextPart;
      return next;
    }
    return [...parts, nextPart].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }

  private rememberFinalizedReadingCaption(caption: FinalizedReadingCaption): void {
    this.finalizedReadingCaptions.delete(caption.captionId);
    this.finalizedReadingCaptions.set(caption.captionId, caption);
    while (this.finalizedReadingCaptions.size > 128) {
      const oldestCaptionId = this.finalizedReadingCaptions.keys().next().value;
      if (oldestCaptionId === undefined) break;
      this.finalizedReadingCaptions.delete(oldestCaptionId);
    }
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
      if (snapshot.captionId < this.captionCounter) {
        // A final recognition result can arrive after silence already closed
        // this caption. Publish the correction without changing the new caption.
        this.emit(snapshot);
        return;
      }
      this.activeBlockId = snapshot.blockId;
      this.currentRevision = Math.max(this.currentRevision, snapshot.revision);
      this.latestLectureSnapshot = snapshot;
      this.emit(snapshot);
      if (snapshot.isFinal) {
        this.captionCounter = Math.max(this.captionCounter, snapshot.captionId + 1);
        this.currentRevision = 0;
        this.latestLectureSnapshot = null;
      }
      return;
    }

    // --- Reading Practice Mode ---
    if (snapshot.captionId < this.captionCounter) {
      const finalized = this.finalizedReadingCaptions.get(snapshot.captionId);
      const parts = this.upsertReadingPart(finalized?.parts ?? [], snapshot);
      const corrected: FinalizedReadingCaption = {
        captionId: snapshot.captionId,
        blockId: finalized?.blockId ?? snapshot.blockId,
        parts,
        revision: Math.max(finalized?.revision ?? 0, snapshot.revision) + 1,
        startMs: Math.min(finalized?.startMs ?? snapshot.startMs, snapshot.startMs),
        endMs: Math.max(finalized?.endMs ?? snapshot.endMs, snapshot.endMs),
      };
      this.rememberFinalizedReadingCaption(corrected);
      this.emit({
        connectionEpoch: snapshot.connectionEpoch,
        providerItemId: snapshot.providerItemId,
        blockId: corrected.blockId,
        captionId: corrected.captionId,
        revision: corrected.revision,
        text: this.combineReadingParts(corrected.parts),
        isFinal: true,
        startMs: corrected.startMs,
        endMs: corrected.endMs,
      });
      return;
    }
    if (this.readingParts.length === 0) this.activeStartMs = snapshot.startMs;
    else this.activeStartMs = Math.min(this.activeStartMs, snapshot.startMs);
    this.activeEndMs = Math.max(this.activeEndMs, snapshot.endMs);
    this.activeBlockId = snapshot.blockId;
    this.providerItemId = snapshot.providerItemId;
    this.readingParts = this.upsertReadingPart(this.readingParts, snapshot);
    this.currentRevision++;
    const fullText = this.combineReadingParts(this.readingParts);

    if (!snapshot.isFinal) {
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
      this.emit({
        connectionEpoch: this.connectionEpoch,
        providerItemId: this.providerItemId,
        blockId: this.activeBlockId,
        captionId: this.captionCounter,
        revision: this.currentRevision,
        text: fullText,
        // Mark as non-final in UI/scheduler so user can continue reading the sentence!
        isFinal: false,
        startMs: this.activeStartMs,
        endMs: this.activeEndMs,
      });
    }
  }

  /**
   * Called when the configured silence interval closes a block or the session finishes.
   */
  public finalizeCurrentUtterance(advanceCaption = true): void {
    if (this.closed) return;

    if (this.mode === 'lecture') {
      const pending = this.latestLectureSnapshot;
      if (!pending || pending.isFinal || !pending.text.trim()) return;
      this.emit({
        ...pending,
        revision: Math.max(this.currentRevision, pending.revision) + 1,
        isFinal: true,
      });
      if (advanceCaption) this.captionCounter = pending.captionId + 1;
      this.currentRevision = 0;
      this.latestLectureSnapshot = null;
      return;
    }

    const fullText = this.combineReadingParts(this.readingParts);
    if (!fullText.trim()) return;
    this.currentRevision++;
    const finalized: FinalizedReadingCaption = {
      captionId: this.captionCounter,
      blockId: this.activeBlockId,
      parts: [...this.readingParts],
      revision: this.currentRevision,
      startMs: this.activeStartMs,
      endMs: this.activeEndMs,
    };
    this.rememberFinalizedReadingCaption(finalized);
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
      this.readingParts = [];
      this.activeStartMs = 0;
      this.activeEndMs = 0;
    }
  }

  public handleBlockClosed(blockId: number): void {
    this.finalizeCurrentUtterance(true);
    this.activeBlockId = blockId + 1;
  }

  public switchMode(newMode: ClassroomMode): void {
    if (this.mode === newMode) return;
    this.finalizeCurrentUtterance(true);
    this.mode = newMode;
  }

  public close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}
