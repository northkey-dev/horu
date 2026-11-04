// AudioWorklet: forwards mono samples to the offscreen page in ~85 ms batches.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const BATCH = 4096;

class RingTap extends AudioWorkletProcessor {
  private buf = new Float32Array(BATCH);
  private pos = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i];
      this.buf[this.pos++] = sum / channels.length;
      if (this.pos === BATCH) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(BATCH);
        this.pos = 0;
      }
    }
    return true;
  }
}

registerProcessor('ring-tap', RingTap);
void sampleRate;
