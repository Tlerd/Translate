/** Stateful linear resampler for microphone PCM chunks with arbitrary boundaries. */
export class Pcm16kResampler {
  private inputRate: number;
  private position = 0;
  private carry = new Float32Array(0);

  constructor(inputRate: number, private readonly outputRate = 16_000) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate) {
      throw new Error(`Unsupported PCM input rate: ${inputRate}`);
    }
    this.inputRate = inputRate;
  }

  public push(chunk: Float32Array): Float32Array {
    return this.process(chunk, false);
  }

  /** Flushes the held boundary sample at end of stream. */
  public flush(): Float32Array {
    return this.process(new Float32Array(0), true);
  }

  private process(chunk: Float32Array, flush: boolean): Float32Array {
    const input = new Float32Array(this.carry.length + chunk.length);
    input.set(this.carry);
    input.set(chunk, this.carry.length);
    if (!input.length) return new Float32Array(0);

    const ratio = this.inputRate / this.outputRate;
    const result: number[] = [];
    while (this.position < input.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      if (left + 1 >= input.length && !flush) break;
      const right = Math.min(left + 1, input.length - 1);
      result.push(input[left] + (input[right] - input[left]) * fraction);
      this.position += ratio;
    }

    const consumed = Math.min(Math.floor(this.position), input.length - 1);
    this.position -= consumed;
    this.carry = input.slice(consumed);
    if (flush) {
      this.carry = new Float32Array(0);
      this.position = 0;
    }
    return Float32Array.from(result);
  }
}

export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}
