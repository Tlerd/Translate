import type { TranscriptSnapshot } from './utterance-assembler';
import {
  segmenterOptionsFor,
  stablePrefixCandidate,
  splitFinal,
  joinTranslations,
  remainingAfterCommitted,
} from './stable-segmenter';

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
  onDelta?: (delta: string) => void,
  requestKind?: 'final' | 'segment' | 'remainder'
) => Promise<string> | AsyncIterable<string>;

export interface TranslationSchedulerOptions {
  runner: TranslationRunner;
  sourceLanguage?: string;
  targetLanguage?: string;
  minIntervalMs?: number;
  requestTimeoutMs?: number;
  historyTurns?: number;
  earlySegments?: boolean;
  pauseMs?: number;
}

interface ScheduledJob {
  snapshot: TranscriptSnapshot;
  sourceToTranslate: string;
  requestKind: 'final' | 'segment' | 'remainder';
  sameCaptionTurns?: ContextTurn[];
}

interface ActiveTranslation {
  job: ScheduledJob;
  requestId: number;
  epoch: number;
  blockId: number;
  captionId: number;
  revision: number;
  sourceText: string;
  requestKind: 'final' | 'segment' | 'remainder';
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
  public earlySegments: boolean;
  public pauseMs: number;

  private listeners: Set<(event: ScheduledTranslationEvent) => void> = new Set();

  private epoch = 0;
  private requestCounter = 0;
  private activeBlockId: number | null = null;
  private closedThroughBlock = 0;

  private jobQueue: ScheduledJob[] = [];

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

  private captionCommittedSegments = new Map<number, { sources: string[]; targets: string[] }>();
  private segmentDebounceTimers = new Map<number, { timer: ReturnType<typeof setTimeout>; candidate: string }>();

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
    this.earlySegments = options.earlySegments ?? false;
    this.pauseMs = options.pauseMs ?? 900;
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

  public setEarlySegments(enabled: boolean): void {
    this.earlySegments = enabled;
    if (!enabled) {
      for (const { timer } of this.segmentDebounceTimers.values()) clearTimeout(timer);
      this.segmentDebounceTimers.clear();
      this.jobQueue = this.jobQueue.filter((job) => job.requestKind !== 'segment');
      this.resolveIdleIfReady();
    }
  }

  public setPauseMs(pauseMs: number): void {
    this.pauseMs = pauseMs;
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

    // If interim, evaluate early segment candidate when enabled
    if (!snapshot.isFinal) {
      if (this.earlySegments && snapshot.text.trim()) {
        this.evaluateEarlySegment(snapshot);
      }
      return;
    }

    // Snapshot is FINAL
    this.clearSegmentTimer(captionId);
    if (!snapshot.text.trim()) {
      return;
    }

    // Early segment final handling
    if (this.activeTranslation?.captionId === captionId &&
        this.activeTranslation.requestKind !== 'segment' &&
        this.matchesLatestJob(this.activeTranslation.job)) {
      this.jobQueue = this.jobQueue.filter((job) => job.snapshot.captionId !== captionId);
      return;
    }
    if (this.activeTranslation?.captionId === captionId &&
        this.activeTranslation.requestKind === 'segment') {
      if (this.matchesLatestJob(this.activeTranslation.job)) {
        // Completion will commit this segment and schedule only the remainder.
        this.jobQueue = this.jobQueue.filter((job) => job.snapshot.captionId !== captionId);
        return;
      }
      this.cancelInflight();
    }
    if (this.earlySegments) {
      const committed = this.captionCommittedSegments.get(captionId);
      if (committed && committed.sources.length > 0) {
        const split = splitFinal(snapshot.text, committed.sources);
        if (split.kind === 'reuse') {
          const fullTarget = joinTranslations(committed.targets, this.targetCode);
          this.jobQueue = this.jobQueue.filter((j) => j.snapshot.captionId !== captionId);
          this.emit({
            captionId,
            blockId: snapshot.blockId,
            sourceText: snapshot.text,
            targetText: fullTarget,
            sourceRevision: snapshot.revision,
            targetSourceRevision: snapshot.revision,
            isFinal: true,
            isProvisional: false,
            startMs: snapshot.startMs,
            endMs: snapshot.endMs,
          });
          this.rememberTranslation(captionId, snapshot.text, fullTarget, snapshot.revision);
          this.recordHistory(captionId, snapshot.text, fullTarget);
          this.cleanupCaption(captionId);
          this.resolveIdleIfReady();
          return;
        }

        if (split.kind === 'remainder') {
          this.jobQueue = this.jobQueue.filter((j) => j.snapshot.captionId !== captionId);
          const sameCaptionTurns: ContextTurn[] = committed.sources.map((src, idx) => ({
            source: src,
            translation: committed.targets[idx] ?? '',
          }));
          this.enqueueJob({
            snapshot,
            sourceToTranslate: split.remainder,
            requestKind: 'remainder',
            sameCaptionTurns,
          });
          return;
        }

        // Mismatch: user corrected early speech. Abort in-flight segment, discard committed, translate full final.
        if (this.activeTranslation?.captionId === captionId) {
          this.cancelInflight();
        }
        this.jobQueue = this.jobQueue.filter((j) => j.snapshot.captionId !== captionId);
        this.captionCommittedSegments.delete(captionId);
      }
    }

    // A punctuation-only final correction needs no second provider request.
    if (
      completed &&
      LiveTranslationScheduler.isEquivalentMeaning(completed.source, snapshot.text)
    ) {
      this.jobQueue = this.jobQueue.filter((j) => j.snapshot.captionId !== captionId);
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

    this.enqueueJob({
      snapshot,
      sourceToTranslate: snapshot.text,
      requestKind: 'final',
    });
  }

  private evaluateEarlySegment(snapshot: TranscriptSnapshot): void {
    const captionId = snapshot.captionId;
    const committed = this.captionCommittedSegments.get(captionId)?.sources ?? [];
    const { stableMs, minChars } = segmenterOptionsFor(this.pauseMs);
    const candidate = stablePrefixCandidate(snapshot.text, committed, minChars);

    const existingTimer = this.segmentDebounceTimers.get(captionId);
    if (candidate) {
      if (existingTimer && existingTimer.candidate === candidate) {
        return;
      }
      if (existingTimer) {
        clearTimeout(existingTimer.timer);
      }
      const timer = setTimeout(() => {
        this.segmentDebounceTimers.delete(captionId);
        if (this.closed || this.captionFinals.get(captionId)) return;
        const latest = this.latestSources.get(captionId) ?? '';
        const curCommitted = this.captionCommittedSegments.get(captionId)?.sources ?? [];
        if (!remainingAfterCommitted(latest, curCommitted)?.startsWith(candidate)) return;

        if (this.activeTranslation?.captionId === captionId &&
            this.activeTranslation.sourceText === candidate &&
            this.matchesLatestJob(this.activeTranslation.job)) return;

        const curTargets = this.captionCommittedSegments.get(captionId)?.targets ?? [];
        const sameCaptionTurns: ContextTurn[] = curCommitted.map((src, idx) => ({
          source: src,
          translation: curTargets[idx] ?? '',
        }));
        this.enqueueJob({
          snapshot,
          sourceToTranslate: candidate,
          requestKind: 'segment',
          sameCaptionTurns,
        });
      }, stableMs);
      this.segmentDebounceTimers.set(captionId, { timer, candidate });
    } else if (existingTimer) {
      clearTimeout(existingTimer.timer);
      this.segmentDebounceTimers.delete(captionId);
    }
  }

  private clearSegmentTimer(captionId: number): void {
    const timerInfo = this.segmentDebounceTimers.get(captionId);
    if (timerInfo) {
      clearTimeout(timerInfo.timer);
      this.segmentDebounceTimers.delete(captionId);
    }
  }

  private enqueueJob(job: ScheduledJob): void {
    const idx = this.jobQueue.findIndex((j) => j.snapshot.captionId === job.snapshot.captionId);
    if (idx >= 0) {
      this.jobQueue[idx] = job;
    } else {
      this.jobQueue.push(job);
    }
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

    if (this.jobQueue.length === 0) {
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

    const toRun = this.jobQueue.shift()!;
    if (!this.matchesLatestJob(toRun)) {
      this.maybeSchedule();
      return;
    }
    this.runJob(toRun, this.epoch);
  }

  private async runJob(job: ScheduledJob, epoch: number): Promise<void> {
    this.lastRequestStartTime = Date.now();
    const snapshot = job.snapshot;
    const captionId = snapshot.captionId;
    const blockId = snapshot.blockId;
    const reqRevision = snapshot.revision;
    const requestId = ++this.requestCounter;
    const abortController = new AbortController();

    const active: ActiveTranslation = {
      job,
      requestId,
      epoch,
      blockId,
      captionId,
      revision: reqRevision,
      sourceText: job.sourceToTranslate,
      requestKind: job.requestKind,
      abortController,
      isCancelled: false,
    };
    this.activeTranslation = active;

    if (this.requestTimeoutMs > 0) {
      active.timeoutId = setTimeout(() => {
        if (active.isCancelled || this.activeTranslation !== active) return;
        this.cancelInflight();
        if (job.requestKind === 'segment' && this.recoverFinalAfterSegment(job)) {
          this.maybeSchedule();
          return;
        }
        if (this.matchesLatestJob(job)) this.onTranslationError(
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
      if (active.isCancelled || epoch !== this.epoch || !this.matchesLatestJob(job)) return;

      const priorTargets = this.captionCommittedSegments.get(captionId)?.targets ?? [];
      const currentDisplay = job.requestKind === 'final'
        ? targetBuffer
        : joinTranslations([...priorTargets, targetBuffer], this.targetCode);

      this.latestTargets.set(captionId, currentDisplay);
      const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
      this.translatedRevisionByCaption.set(captionId, latestRev);

      this.emit({
        captionId,
        blockId,
        sourceText: this.latestSources.get(captionId) || snapshot.text,
        targetText: currentDisplay,
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
      const historyToPass = this.selectHistory(job);

      const result = await this.runner(
        job.sourceToTranslate,
        { sourceCode: this.sourceCode, targetCode: this.targetCode },
        historyToPass,
        abortController.signal,
        snapshot,
        (delta) => {
          if (active.isCancelled || epoch !== this.epoch) return;
          targetBuffer += delta;
          emitThrottledDelta();
        },
        job.requestKind
      );

      if (typeof result === 'string') {
        targetBuffer = result;
      } else if (result && Symbol.asyncIterator in (result as object)) {
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
        this.onJobDone(job, targetBuffer, epoch);
      }
    } catch (err: unknown) {
      if (pendingDeltaTimer) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
      }
      if (!active.isCancelled && epoch === this.epoch && this.matchesLatestJob(job)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (job.requestKind === 'segment') {
          this.recoverFinalAfterSegment(job);
        } else {
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

  private onJobDone(job: ScheduledJob, targetText: string, epoch: number): void {
    const snapshot = job.snapshot;
    const captionId = snapshot.captionId;
    const blockId = snapshot.blockId;
    const reqRevision = snapshot.revision;

    if (epoch !== this.epoch || !this.matchesLatestJob(job)) return;

    const latestRev = this.latestRevisions.get(captionId) ?? reqRevision;
    const latestSource = this.latestSources.get(captionId) || snapshot.text;

    if (job.requestKind === 'segment') {
      const committed = this.captionCommittedSegments.get(captionId) ?? { sources: [], targets: [] };
      committed.sources.push(job.sourceToTranslate);
      committed.targets.push(targetText);
      this.captionCommittedSegments.set(captionId, committed);

      const fullDisplay = joinTranslations(committed.targets, this.targetCode);
      this.latestTargets.set(captionId, fullDisplay);
      this.translatedRevisionByCaption.set(captionId, latestRev);

      this.emit({
        captionId,
        blockId,
        sourceText: latestSource,
        targetText: fullDisplay,
        sourceRevision: latestRev,
        targetSourceRevision: latestRev,
        isFinal: false,
        isProvisional: true,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
      });

      // Check if a final snapshot arrived while this segment was in-flight
      if (this.captionFinals.get(captionId)) {
        this.jobQueue = this.jobQueue.filter((queued) => queued.snapshot.captionId !== captionId);
        const split = splitFinal(latestSource, committed.sources);
        if (split.kind === 'reuse') {
          this.emit({
            captionId,
            blockId,
            sourceText: latestSource,
            targetText: fullDisplay,
            sourceRevision: latestRev,
            targetSourceRevision: latestRev,
            isFinal: true,
            isProvisional: false,
            startMs: snapshot.startMs,
            endMs: snapshot.endMs,
          });
          this.rememberTranslation(captionId, latestSource, fullDisplay, latestRev);
          this.recordHistory(captionId, latestSource, fullDisplay);
          this.cleanupCaption(captionId);
        } else if (split.kind === 'remainder') {
          const sameCaptionTurns: ContextTurn[] = committed.sources.map((src, idx) => ({
            source: src,
            translation: committed.targets[idx] ?? '',
          }));
          this.enqueueJob({
            snapshot: { ...snapshot, text: latestSource, revision: latestRev, isFinal: true },
            sourceToTranslate: split.remainder,
            requestKind: 'remainder',
            sameCaptionTurns,
          });
        } else {
          this.captionCommittedSegments.delete(captionId);
          this.enqueueJob({
            snapshot: { ...snapshot, text: latestSource, revision: latestRev, isFinal: true },
            sourceToTranslate: latestSource,
            requestKind: 'final',
          });
        }
      } else if (this.earlySegments) {
        // A longer ASR snapshot may have arrived while the segment was running.
        // Recompute its uncommitted prefix rather than queueing the same words.
        this.clearSegmentTimer(captionId);
        this.evaluateEarlySegment({ ...snapshot, text: latestSource, revision: latestRev });
      }
      return;
    }

    if (job.requestKind === 'remainder') {
      const committed = this.captionCommittedSegments.get(captionId) ?? { sources: [], targets: [] };
      committed.sources.push(job.sourceToTranslate);
      committed.targets.push(targetText);
      const fullDisplay = joinTranslations(committed.targets, this.targetCode);

      this.latestTargets.set(captionId, fullDisplay);
      this.translatedRevisionByCaption.set(captionId, latestRev);

      this.emit({
        captionId,
        blockId,
        sourceText: latestSource,
        targetText: fullDisplay,
        sourceRevision: latestRev,
        targetSourceRevision: latestRev,
        isFinal: true,
        isProvisional: false,
        startMs: snapshot.startMs,
        endMs: snapshot.endMs,
      });

      if (fullDisplay) {
        this.rememberTranslation(captionId, latestSource, fullDisplay, latestRev);
        this.recordHistory(captionId, latestSource, fullDisplay);
      }
      this.cleanupCaption(captionId);
      return;
    }

    // Final job
    this.latestTargets.set(captionId, targetText);
    this.translatedRevisionByCaption.set(captionId, latestRev);

    this.emit({
      captionId,
      blockId,
      sourceText: latestSource,
      targetText,
      sourceRevision: latestRev,
      targetSourceRevision: latestRev,
      isFinal: true,
      isProvisional: false,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
    });

    if (targetText) {
      this.rememberTranslation(captionId, latestSource, targetText, latestRev);
      this.recordHistory(captionId, latestSource, targetText);
    }
    this.cleanupCaption(captionId);
  }

  private recoverFinalAfterSegment(job: ScheduledJob): boolean {
    const captionId = job.snapshot.captionId;
    const source = this.latestSources.get(captionId);
    if (!this.captionFinals.get(captionId) || !source?.trim()) return false;
    // A final waiting on a failed/expired early request must still be translated.
    // Fall back once to a full final; final failure does not recursively retry.
    this.captionCommittedSegments.delete(captionId);
    this.enqueueJob({
      snapshot: { ...job.snapshot, text: source, revision: this.latestRevisions.get(captionId) ?? job.snapshot.revision, isFinal: true },
      sourceToTranslate: source,
      requestKind: 'final',
    });
    return true;
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
    this.captionCommittedSegments.delete(captionId);
    this.clearSegmentTimer(captionId);
  }

  private selectHistory(job: ScheduledJob): ContextTurn[] {
    if (this.historyTurns === 0) return [];
    // Same-caption segments are most recent and consume the same pair budget.
    const previous = this.contextHistory
      .filter((turn) => turn.captionId !== job.snapshot.captionId)
      .map(({ source, translation }) => ({ source, translation }));
    return [...previous, ...(job.sameCaptionTurns ?? [])].slice(-this.historyTurns);
  }

  private matchesLatestJob(job: ScheduledJob): boolean {
    const latestSource = this.latestSources.get(job.snapshot.captionId);
    if (latestSource === undefined) return false;
    if (job.requestKind !== 'segment') {
      return LiveTranslationScheduler.isEquivalentMeaning(job.snapshot.text, latestSource);
    }
    const prior = job.sameCaptionTurns?.map((turn) => turn.source) ?? [];
    const committed = this.captionCommittedSegments.get(job.snapshot.captionId)?.sources ?? [];
    if (prior.length !== committed.length || prior.some((source, i) => source !== committed[i])) return false;
    return splitFinal(latestSource, [...prior, job.sourceToTranslate]).kind !== 'mismatch';
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
    this.contextHistory.sort((a, b) => a.captionId - b.captionId);
    this.contextHistory = this.contextHistory.slice(-6);
  }

  public async drain(): Promise<void> {
    this.maybeSchedule();
    if (!this.activeTranslation && this.jobQueue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdleIfReady(): void {
    if (this.activeTranslation || this.jobQueue.length > 0) return;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  public close(): void {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const { timer } of this.segmentDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.segmentDebounceTimers.clear();
    this.cancelInflight();
    this.jobQueue = [];
    this.resolveIdleIfReady();
    this.listeners.clear();
  }
}
