/** Captures mono Float32 PCM from an existing microphone stream. */
export class GeminiPcmCapture {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  public get sampleRate(): number | null {
    return this.context?.sampleRate ?? null;
  }

  public get state(): AudioContextState | 'unavailable' {
    return this.context?.state ?? 'unavailable';
  }

  /** Call directly from the record button gesture before waiting on network requests. */
  public async prepare(): Promise<void> {
    const context = this.ensureContext();
    await context.resume();
    if (context.state !== 'running') {
      throw new Error(`AudioContext did not start (state: ${context.state}). Retry from the record-button gesture.`);
    }
  }

  /** The stream remains owned by its caller; stopping capture never stops tracks. */
  public async start(stream: MediaStream, onPcm: (pcm: Float32Array, sampleRate: number) => void): Promise<void> {
    if (this.processor) throw new Error('PCM capture is already active.');
    const context = this.ensureContext();
    this.source = context.createMediaStreamSource(stream);
    // ScriptProcessor is retained here for broad iOS Safari support; work is limited to copying PCM.
    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      onPcm(new Float32Array(input), context.sampleRate);
      event.outputBuffer.getChannelData(0).fill(0);
    };
    this.source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    if (context.state !== 'running') {
      await this.stop();
      throw new Error(`AudioContext is not running (state: ${context.state}).`);
    }
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const Context = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error('Web Audio is unavailable in this browser.');
    const context = new Context();
    this.context = context;
    return context;
  }

  public async stop(): Promise<void> {
    const context = this.context;
    this.context = null;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch { /* already disconnected */ }
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch { /* already disconnected */ }
      this.source = null;
    }
    if (context && context.state !== 'closed') await context.close();
  }
}
