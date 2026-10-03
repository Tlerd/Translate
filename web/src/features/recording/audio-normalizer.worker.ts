import { normalizeAudio, type AudioPart } from './normalize-audio';

const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<AudioPart[]>) => void) | null; postMessage: (value: unknown) => void };
worker.onmessage = event => {
  void normalizeAudio(event.data).then(result => worker.postMessage({ result }), error => worker.postMessage({ error: error instanceof Error ? error.message : String(error) }));
};
