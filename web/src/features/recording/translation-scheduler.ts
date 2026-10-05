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
  requestTimeoutMs?: number;
  historyTurns?: number;
}

interface ActiveTranslation {
  requestId: number;
  epoch: number;
  blockId: number;
  captionId: number;
  revision: number;
  sourceText: string;
  abortController: AbortController;
  timeoutId?: ReturnType<typeof setTimeout>;
  isCancelled: boolean;
}

export class LiveTranslationScheduler {
  public runner: TranslationRunner;
  public sourceCode: string;
  public targetCode: string;
  public minIntervalMs: number;
  public requestTimeoutMs: number;
  public historyTurns: number;

  private listeners: Set<(event: ScheduledTranslationEvent) => void> = new Set();

  private epoch = 0;
  private requestCounter = 0;
  private activeBlockId: number | null = null;
  private closedThroughBlock = 0;

  private finalQueue: TranscriptSnapshot[] = [];

  private activeTranslation: ActiveTranslation | null = null;
  private lastRequestStartTime = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private latestRevisions: Map<number, number> = new Map();
  private latestSources: Map<number, string> = new Map();
  private latestTargets: Map<number, string> = new Map();
  private captionFinals: Map<number, boolean> = new Map();
  private acceptedCaptionVersions = new Map<number, { revision: number; isFinal: boolean }>();

  private translatedRevisionByCaption: Map<number, number> = new Map();
  private completedTranslations = new Map<number, { source: string; target: string; revision: number }>();

  private contextHistory: Array<ContextTurn & { captionId: number }> = [];
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: TranslationSchedulerOptions) {
    this.runner = options.runner;
    this.sourceCode = options.sourceLanguage || 'ja';
    this.targetCode = options.targetLanguage || 'vi';
    this.minIntervalMs = options.minIntervalMs ?? 700;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12000;
    this.historyTurns = options.historyTurns !== undefined
      ? Math.max(0, Math.min(6, Math.floor(options.historyTurns)))
      : 6;
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

  public setHistoryTurns(turns: number): void {
    this.historyTurns = Math.max(0, Math.min(6, Math.floor(turns)));
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
    const accepted = this.acceptedCaptionVersions.get(captionId);
    if (
      accepted &&
      (snapshot.revision <= accepted.revision || (accepted.isFinal && !snapshot.isFinal))
    ) return;
    this.acceptedCaptionVersions.delete(captionId);
    this.acceptedCaptionVersions.set(captionId, { revision: snapshot.revision, isFinal: snapshot.isFinal });
    while (this.acceptedCaptionVersions.size > 1024) {
      const oldestCaptionId = this.acceptedCaptionVersions.keys().next().value;
      if (oldestCaptionId === undefined) break;
      this.acceptedCaptionVersions.delete(oldestCaptionId);
    }
    this.latestRevisions.set(captionId, snapshot.revision);
    this.latestSources.set(captionId, snapshot.text);
    if (snapshot.isFinal) {
      this.captionFinals.set(captionId, true);
    }
    const completed = this.completedTranslations.get(captionId);
    if (completed && !this.latestTargets.has(captionId)) {
      this.latestTargets.set(captionId, completed.target);
      this.translatedRevisionByCaption.set(captionId, completed.revision);
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

    // ASR hypotheses stay visible, but only committed utterances spend tokens.
    // Silence/pause/stop are finalized by the assembler before reaching here.
    if (!snapshot.isFinal || !snapshot.text.trim()) {
      return;
    }

    // A punctuation-only final correction needs no second provider request.
    if (
      completed &&
      LiveTranslationScheduler.isEquivalentMeaning(completed.source, snapshot.text)
    ) {
      this.finalQueue = this.finalQueue.filter((queued) => queued.captionId !== captionId);
      this.emit({
        captionId,
        blockId: snapshot.blockId,
        sourceText: snapshot.text,
        targetText: completed.target,
        sourceRevision: snapshot.revision,
        targetSourceRevision: snapshot.revision,
        isFinal: true,
        isProvisional: false,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
      });
      this.rememberTranslation(captionId, snapshot.text, completed.target, snapshot.revision);
      this.recordHistory(captionId, snapshot.text, completed.target);
      this.cleanupCaption(captionId);
      return;
    }

    // Reuse the active stream too; completion will promote it to the latest
    // equivalent source revision. Do not abort and restart already billed work.
    if (this.activeTranslation?.captionId === captionId &&
        LiveTranslationScheduler.isEquivalentMeaning(this.activeTranslation.sourceText, snapshot.text)) {
      this.finalQueue = this.finalQueue.filter((queued) => queued.captionId !== captionId);
      return;
    }

    const queuedCaptionIndex = this.finalQueue.findIndex((queued) => queued.captionId === captionId);
    if (queuedCaptionIndex >= 0) this.finalQueue[queuedCaptionIndex] = snapshot;
    else this.finalQueue.push(snapshot);
    this.maybeSchedule();
  }

  public onBlockClosed(blockId: number): void {
    if (this.closed) return;
    this.closedThroughBlock = Math.max(this.closedThroughBlock, blockId);
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

    if (this.finalQueue.length === 0) {
      this.resolveIdleIfReady();
      return;
    }

    const elapsedSinceLast = Date.now() - this.lastRequestStartTime;
    if (elapsedSinceLast < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - elapsedSinceLast;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        if (!this.closed) this.maybeSchedule();
      }, waitMs);
      return;
    }

    const toRun = this.finalQueue.shift()!;
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
      sourceText: snapshot.text,
      abortController,
      isCancelled: false,
    };
    this.activeTranslation = active;

    if (this.requestTimeoutMs > 0) {
      active.timeoutId = setTimeout(() => {
        if (active.isCancelled || this.activeTranslation !== active) return;
        this.cancelInflight();
        if (this.matchesLatestSource(captionId, snapshot.text)) this.onTranslationError(
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

    let lastDeltaEmitTime = 0;
    let pendingDeltaTimer: ReturnType<typeof setTimeout> | null = null;

    const flushThrottledDelta = () => {
      if (pendingDeltaTimer) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
      }
      if (active.isCancelled || epoch !== this.epoch || !this.matchesLatestSource(captionId, snapshot.text)) return;
      this.latestTargets.set(captionId, targetBuffer);
      const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
      this.translatedRevisionByCaption.set(captionId, latestRev);

      this.emit({
        captionId,
        blockId,
        sourceText: this.latestSources.get(captionId) || snapshot.text,
        targetText: targetBuffer,
        sourceRevision: latestRev,
        targetSourceRevision: latestRev,
        isFinal: false,
        isProvisional: true,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
      });
      lastDeltaEmitTime = Date.now();
    };

    const emitThrottledDelta = () => {
      const now = Date.now();
      if (now - lastDeltaEmitTime >= 120) {
        flushThrottledDelta();
      } else if (!pendingDeltaTimer) {
        pendingDeltaTimer = setTimeout(() => {
          flushThrottledDelta();
        }, 120 - (now - lastDeltaEmitTime));
      }
    };

    try {
      const historyToPass = this.historyTurns === 0
        ? []
        : this.contextHistory
            .filter((turn) => turn.captionId !== captionId)
            .slice(-this.historyTurns)
            .map(({ source, translation }) => ({ source, translation }));

      const result = await this.runner(
        snapshot.text,
        { sourceCode: this.sourceCode, targetCode: this.targetCode },
        historyToPass,
        abortController.signal,
        snapshot,
        (delta) => {
          if (active.isCancelled || epoch !== this.epoch) return;
          targetBuffer += delta;
          emitThrottledDelta();
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
          emitThrottledDelta();
        }
      }

      if (pendingDeltaTimer) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
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
      if (pendingDeltaTimer) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
      }
      if (!active.isCancelled && epoch === this.epoch && this.matchesLatestSource(captionId, snapshot.text)) {
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
      if (pendingDeltaTimer) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
      }
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
    if (epoch !== this.epoch || !this.matchesLatestSource(captionId, snapshot.text)) return;

    const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
    const isFinalCaption = this.captionFinals.get(captionId) === true;
    const isProvisional = !isFinalCaption;
    const latestSource = this.latestSources.get(captionId) || snapshot.text;

    this.latestTargets.set(captionId, targetText);
    this.translatedRevisionByCaption.set(captionId, latestRev);

    this.emit({
      captionId,
      blockId,
      sourceText: latestSource,
      targetText,
      sourceRevision: latestRev,
      targetSourceRevision: latestRev,
      isFinal: !isProvisional,
      isProvisional,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
    });

    if (!isProvisional && targetText) {
      this.rememberTranslation(captionId, latestSource, targetText, latestRev);
      this.recordHistory(captionId, latestSource, targetText);
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
    this.translatedRevisionByCaption.delete(captionId);
  }

  private matchesLatestSource(captionId: number, source: string): boolean {
    const latestSource = this.latestSources.get(captionId);
    return latestSource !== undefined && LiveTranslationScheduler.isEquivalentMeaning(source, latestSource);
  }

  private rememberTranslation(captionId: number, source: string, target: string, revision: number): void {
    this.completedTranslations.delete(captionId);
    this.completedTranslations.set(captionId, { source, target, revision });
    while (this.completedTranslations.size > 128) {
      const oldestCaptionId = this.completedTranslations.keys().next().value;
      if (oldestCaptionId === undefined) break;
      this.completedTranslations.delete(oldestCaptionId);
    }
  }

  private recordHistory(captionId: number, source: string, target: string): void {
    const turn = { captionId, source, translation: target };
    const index = this.contextHistory.findIndex((previous) => previous.captionId === captionId);
    if (index >= 0) this.contextHistory[index] = turn;
    else this.contextHistory.push(turn);
    // A late correction keeps its place in the conversation, including when
    // it is older than the retained context window.
    this.contextHistory.sort((a, b) => a.captionId - b.captionId);
    this.contextHistory = this.contextHistory.slice(-6);
  }

  public async drain(): Promise<void> {
    this.maybeSchedule();
    if (!this.activeTranslation && this.finalQueue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdleIfReady(): void {
    if (this.activeTranslation || this.finalQueue.length > 0) return;
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
    this.finalQueue = [];
    this.resolveIdleIfReady();
    this.listeners.clear();
  }
}
