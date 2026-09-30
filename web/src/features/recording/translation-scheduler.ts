import type { TranscriptSnapshot } from './utterance-assembler';

export interface ContextTurn {
  source: string;
  translation: string;
}

export interface ScheduledTranslationEvent {
  captionId: number;
  blockId: number;
  sourceText: string;
  targetText: string;
  sourceRevision: number;
  targetSourceRevision: number;
  isFinal: boolean;
  isProvisional: boolean;
  startMs: number;
  endMs: number;
  skipReason?: string;
  error?: string;
}

export type TranslationRunner = (
  source: string,
  direction: { sourceCode: string; targetCode: string },
  history: ContextTurn[],
  signal: AbortSignal,
  snapshot?: TranscriptSnapshot,
  onDelta?: (delta: string) => void
) => Promise<string> | AsyncIterable<string>;

export interface TranslationSchedulerOptions {
  runner: TranslationRunner;
  sourceLanguage?: string;
  targetLanguage?: string;
  minIntervalMs?: number;
  maxAgeMs?: number;
  requestTimeoutMs?: number;
}

interface ActiveTranslation {
  requestId: number;
  epoch: number;
  blockId: number;
  captionId: number;
  revision: number;
  abortController: AbortController;
  timeoutId?: ReturnType<typeof setTimeout>;
  isCancelled: boolean;
}

export class LiveTranslationScheduler {
  public runner: TranslationRunner;
  public sourceCode: string;
  public targetCode: string;
  public minIntervalMs: number;
  public maxAgeMs: number;
  public requestTimeoutMs: number;

  private listeners: Set<(event: ScheduledTranslationEvent) => void> = new Set();

  private epoch = 0;
  private requestCounter = 0;
  private activeBlockId: number | null = null;
  private closedThroughBlock = 0;

  private pendingSnapshot: TranscriptSnapshot | null = null;
  private pendingSnapshotTime: number | null = null;
  private finalQueue: TranscriptSnapshot[] = [];

  private activeTranslation: ActiveTranslation | null = null;
  private lastRequestStartTime = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private latestRevisions: Map<number, number> = new Map();
  private latestSources: Map<number, string> = new Map();
  private latestTargets: Map<number, string> = new Map();
  private captionFinals: Map<number, boolean> = new Map();

  private translatedSourceByCaption: Map<number, string> = new Map();
  private translatedRevisionByCaption: Map<number, number> = new Map();

  private contextHistory: ContextTurn[] = [];
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: TranslationSchedulerOptions) {
    this.runner = options.runner;
    this.sourceCode = options.sourceLanguage || 'ja';
    this.targetCode = options.targetLanguage || 'vi';
    this.minIntervalMs = options.minIntervalMs ?? 700;
    this.maxAgeMs = options.maxAgeMs ?? 3000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12000;
  }

  public subscribe(listener: (event: ScheduledTranslationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ScheduledTranslationEvent): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in TranslationEventListener:', err);
      }
    }
  }

  public setLanguages(source: string, target: string): void {
    this.sourceCode = source;
    this.targetCode = target;
  }

  public setActiveBlock(blockId: number): void {
    this.activeBlockId = blockId;
  }

  public static isEquivalentMeaning(a: string, b: string): boolean {
    if (a === b) return true;
    const normalize = (s: string) => s.replace(/[\s\.,!\?、。！？]+$/g, '').trim();
    const normA = normalize(a);
    const normB = normalize(b);
    return normA.length > 0 && normA === normB;
  }

  public onSnapshot(snapshot: TranscriptSnapshot): void {
    if (this.closed) return;

    const captionId = snapshot.captionId;
    this.latestRevisions.set(captionId, snapshot.revision);
    this.latestSources.set(captionId, snapshot.text);
    if (snapshot.isFinal) {
      this.captionFinals.set(captionId, true);
    }

    // Check if block was already closed
    if (snapshot.blockId <= this.closedThroughBlock && !snapshot.isFinal) {
      this.emit({
        captionId,
        blockId: snapshot.blockId,
        sourceText: snapshot.text,
        targetText: this.latestTargets.get(captionId) || '',
        sourceRevision: snapshot.revision,
        targetSourceRevision: this.translatedRevisionByCaption.get(captionId) ?? 0,
        isFinal: snapshot.isFinal,
        isProvisional: false,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
        skipReason: 'closed',
      });
      return;
    }

    this.activeBlockId = snapshot.blockId;

    // Immediately emit source update so UI displays text while talking
    this.emit({
      captionId,
      blockId: snapshot.blockId,
      sourceText: snapshot.text,
      targetText: this.latestTargets.get(captionId) || '',
      sourceRevision: snapshot.revision,
      targetSourceRevision: this.translatedRevisionByCaption.get(captionId) ?? 0,
      isFinal: snapshot.isFinal,
      isProvisional: !snapshot.isFinal,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
    });

    if (!snapshot.text.trim()) return;

    // If final transcript meaning matches already translated text, reuse result
    const translatedSource = this.translatedSourceByCaption.get(captionId);
    const latestTarget = this.latestTargets.get(captionId);
    if (
      snapshot.isFinal &&
      translatedSource &&
      LiveTranslationScheduler.isEquivalentMeaning(translatedSource, snapshot.text) &&
      latestTarget
    ) {
      this.emit({
        captionId,
        blockId: snapshot.blockId,
        sourceText: snapshot.text,
        targetText: latestTarget,
        sourceRevision: snapshot.revision,
        targetSourceRevision: snapshot.revision,
        isFinal: true,
        isProvisional: false,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
      });
      this.translatedRevisionByCaption.set(captionId, snapshot.revision);
      this.recordHistory(snapshot.text, latestTarget);
      this.cleanupCaption(captionId);
      return;
    }

    if (snapshot.isFinal) {
      if (this.pendingSnapshot?.captionId === captionId) {
        this.pendingSnapshot = null;
        this.pendingSnapshotTime = null;
      }
      const queuedCaptionIndex = this.finalQueue.findIndex((queued) => queued.captionId === captionId);
      if (queuedCaptionIndex >= 0) this.finalQueue[queuedCaptionIndex] = snapshot;
      else this.finalQueue.push(snapshot);
    } else {
      // Interim hypotheses are replaceable; final sentences are never replaced.
      this.pendingSnapshot = snapshot;
      this.pendingSnapshotTime = Date.now();
    }

    this.maybeSchedule();
  }

  public onBlockClosed(blockId: number): void {
    if (this.closed) return;
    this.closedThroughBlock = Math.max(this.closedThroughBlock, blockId);
    if (this.pendingSnapshot?.blockId === blockId) {
      this.pendingSnapshot = null;
      this.pendingSnapshotTime = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.maybeSchedule();
    this.resolveIdleIfReady();
  }

  private cancelInflight(): void {
    if (this.activeTranslation) {
      this.activeTranslation.isCancelled = true;
      if (this.activeTranslation.timeoutId) {
        clearTimeout(this.activeTranslation.timeoutId);
      }
      this.activeTranslation.abortController.abort();
      this.activeTranslation = null;
    }
  }

  private maybeSchedule(): void {
    if (this.closed || this.activeTranslation !== null) return;

    const nextFinal = this.finalQueue[0];
    if (!nextFinal && !this.pendingSnapshot) {
      this.resolveIdleIfReady();
      return;
    }

    const now = Date.now();
    const age = this.pendingSnapshot ? now - (this.pendingSnapshotTime || now) : 0;
    if (!nextFinal && this.pendingSnapshot && age > this.maxAgeMs) {
      // Snapshot expired before translator was free; supersede it
      this.emit({
        captionId: this.pendingSnapshot!.captionId,
        blockId: this.pendingSnapshot!.blockId,
        sourceText: this.pendingSnapshot!.text,
        targetText: this.latestTargets.get(this.pendingSnapshot!.captionId) || '',
        sourceRevision: this.pendingSnapshot!.revision,
        targetSourceRevision: 0,
        isFinal: false,
        isProvisional: true,
        startMs: this.pendingSnapshot!.startMs,
        endMs: this.pendingSnapshot!.endMs,
        skipReason: 'stale',
      });
      this.pendingSnapshot = null;
      this.pendingSnapshotTime = null;
      this.resolveIdleIfReady();
      return;
    }

    const elapsedSinceLast = now - this.lastRequestStartTime;
    if (elapsedSinceLast < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - elapsedSinceLast;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        if (!this.closed) this.maybeSchedule();
      }, waitMs);
      return;
    }

    const toRun = this.finalQueue.shift() || this.pendingSnapshot!;
    if (toRun === this.pendingSnapshot) {
      this.pendingSnapshot = null;
      this.pendingSnapshotTime = null;
    }
    this.runTranslation(toRun, this.epoch);
  }

  private async runTranslation(snapshot: TranscriptSnapshot, epoch: number): Promise<void> {
    this.lastRequestStartTime = Date.now();
    const captionId = snapshot.captionId;
    const blockId = snapshot.blockId;
    const reqRevision = snapshot.revision;
    const requestId = ++this.requestCounter;
    const abortController = new AbortController();

    const active: ActiveTranslation = {
      requestId,
      epoch,
      blockId,
      captionId,
      revision: reqRevision,
      abortController,
      isCancelled: false,
    };
    this.activeTranslation = active;

    if (this.requestTimeoutMs > 0) {
      active.timeoutId = setTimeout(() => {
        if (active.isCancelled || this.activeTranslation !== active) return;
        this.cancelInflight();
        this.onTranslationError(
          captionId,
          blockId,
          snapshot.text,
          reqRevision,
          'Hết thời gian dịch live',
          snapshot.startMs,
          snapshot.endMs
        );
        this.maybeSchedule();
      }, this.requestTimeoutMs);
    }

    let targetBuffer = '';

    try {
      const result = await this.runner(
        snapshot.text,
        { sourceCode: this.sourceCode, targetCode: this.targetCode },
        [...this.contextHistory],
        abortController.signal,
        snapshot,
        (delta) => {
          if (active.isCancelled || epoch !== this.epoch) return;
          targetBuffer += delta;
          this.latestTargets.set(captionId, targetBuffer);
          this.emit({
            captionId, blockId,
            sourceText: this.latestSources.get(captionId) || snapshot.text,
            targetText: targetBuffer,
            sourceRevision: this.latestRevisions.get(captionId) ?? reqRevision,
            targetSourceRevision: reqRevision,
            isFinal: false,
            isProvisional: true,
            startMs: snapshot.startMs,
            endMs: snapshot.endMs,
          });
        }
      );

      if (typeof result === 'string') {
        targetBuffer = result;
      } else if (result && Symbol.asyncIterator in (result as object)) {
        // Stream
        for await (const delta of result as AsyncIterable<string>) {
          if (active.isCancelled || epoch !== this.epoch) {
            break;
          }
          targetBuffer += delta;
          this.latestTargets.set(captionId, targetBuffer);

          const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
          const isProvisional = latestRev > reqRevision || !this.captionFinals.get(captionId);

          this.emit({
            captionId,
            blockId,
            sourceText: this.latestSources.get(captionId) || snapshot.text,
            targetText: targetBuffer,
            sourceRevision: latestRev,
            targetSourceRevision: reqRevision,
            isFinal: !isProvisional,
            isProvisional,
            startMs: snapshot.startMs,
            endMs: snapshot.endMs,
          });
        }
      }

      if (!active.isCancelled && epoch === this.epoch) {
        this.onTranslationDone(
          captionId,
          blockId,
          snapshot,
          reqRevision,
          targetBuffer,
          epoch
        );
      }
    } catch (err: unknown) {
      if (!active.isCancelled && epoch === this.epoch) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.onTranslationError(
          captionId,
          blockId,
          snapshot.text,
          reqRevision,
          errorMsg,
          snapshot.startMs,
          snapshot.endMs
        );
      }
    } finally {
      if (active.timeoutId) {
        clearTimeout(active.timeoutId);
      }
      if (this.activeTranslation === active) {
        this.activeTranslation = null;
      }
      if (!this.closed) {
        this.maybeSchedule();
      }
    }
  }

  private onTranslationDone(
    captionId: number,
    blockId: number,
    snapshot: TranscriptSnapshot,
    reqRevision: number,
    targetText: string,
    epoch: number
  ): void {
    if (epoch !== this.epoch) return;

    const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
    const isFinalCaption = this.captionFinals.get(captionId) === true;
    const isProvisional = latestRev > reqRevision || !isFinalCaption;

    this.latestTargets.set(captionId, targetText);
    this.translatedSourceByCaption.set(captionId, snapshot.text);
    this.translatedRevisionByCaption.set(captionId, reqRevision);

    this.emit({
      captionId,
      blockId,
      sourceText: this.latestSources.get(captionId) || snapshot.text,
      targetText,
      sourceRevision: latestRev,
      targetSourceRevision: reqRevision,
      isFinal: !isProvisional,
      isProvisional,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
    });

    if (!isProvisional && targetText) {
      this.recordHistory(snapshot.text, targetText);
    }
    if (!isProvisional) this.cleanupCaption(captionId);
  }

  private onTranslationError(
    captionId: number,
    blockId: number,
    sourceText: string,
    reqRevision: number,
    error: string,
    startMs: number,
    endMs: number
  ): void {
    this.emit({
      captionId,
      blockId,
      sourceText: this.latestSources.get(captionId) || sourceText,
      targetText: this.latestTargets.get(captionId) || '',
      sourceRevision: this.latestRevisions.get(captionId) ?? reqRevision,
      targetSourceRevision: reqRevision,
      isFinal: false,
      isProvisional: true,
      startMs,
      endMs,
      error,
    });
    if (this.captionFinals.get(captionId)) this.cleanupCaption(captionId);
  }

  private cleanupCaption(captionId: number): void {
    this.latestRevisions.delete(captionId);
    this.latestSources.delete(captionId);
    this.latestTargets.delete(captionId);
    this.captionFinals.delete(captionId);
    this.translatedSourceByCaption.delete(captionId);
    this.translatedRevisionByCaption.delete(captionId);
  }

  private recordHistory(source: string, target: string): void {
    this.contextHistory.push({ source, translation: target });
    // Keep max 6 turns
    if (this.contextHistory.length > 6) {
      this.contextHistory.shift();
    }
  }

  public async drain(): Promise<void> {
    this.maybeSchedule();
    if (!this.activeTranslation && this.finalQueue.length === 0 && !this.pendingSnapshot) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdleIfReady(): void {
    if (this.activeTranslation || this.finalQueue.length > 0 || this.pendingSnapshot) return;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  public close(): void {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.cancelInflight();
    this.pendingSnapshot = null;
    this.pendingSnapshotTime = null;
    this.finalQueue = [];
    this.resolveIdleIfReady();
    this.listeners.clear();
  }
}
