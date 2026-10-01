import type { Interactions } from '@google/genai';

export interface DiarizedWordSegment {
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
}

type WordAnnotation = Pick<Interactions.WordInfo, 'type' | 'speaker' | 'start_offset' | 'end_offset' | 'text'>;

function offsetMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return null;
  const valueMs = Number(match[1]) * 1000;
  return Number.isFinite(valueMs) ? valueMs : null;
}

/** Extract only provider word annotations; never substitute output_text for them. */
export function extractDiarizedWordSegments(
  interaction: Pick<Interactions.Interaction, 'steps'>,
  durationMs: number
): DiarizedWordSegment[] {
  const words: WordAnnotation[] = [];
  for (const step of interaction.steps ?? []) {
    if (!('content' in step) || !Array.isArray(step.content)) continue;
    for (const content of step.content) {
      if (!('annotations' in content) || !Array.isArray(content.annotations)) continue;
      for (const annotation of content.annotations) {
        if (annotation.type === 'word_info') words.push(annotation);
      }
    }
  }

  return words.flatMap((word) => {
    const startMs = offsetMs(word.start_offset);
    const endMs = offsetMs(word.end_offset);
    if (
      !word.speaker || !word.text || startMs === null || endMs === null ||
      startMs < 0 || endMs < startMs || startMs > durationMs || endMs > durationMs + 1000
    ) return [];
    return [{ speakerLabel: word.speaker, startMs, endMs, text: word.text }];
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
