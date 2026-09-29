import 'server-only';
import type { CaptionItem } from '@/shared/recording';

export function buildSummarySystemPrompt(targetLanguage: string): string {
  return `You are an expert summarizer for language classes and conversation recordings.
Create a faithful, structured summary in ${targetLanguage === 'vi' ? 'Vietnamese' : targetLanguage} based STRICTLY on the provided transcript captions.
Do not add outside facts or extrapolate unmentioned details.

You must respond with valid JSON ONLY, strictly following this JSON schema:
{
  "title": "A concise, informative title of the session",
  "overview": "A brief overview paragraph (2-4 sentences) summarizing the main topic and core discussion",
  "sections": [
    {
      "heading": "Section or topic heading",
      "bullets": [
        "Key point 1",
        "Key point 2"
      ],
      "captionIds": [1, 2]
    }
  ]
}

CRITICAL RULES:
1. Every item in 'captionIds' MUST be an integer ID taken from the input captions where the information was sourced. Never invent non-existent caption IDs.
2. Return ONLY the JSON object. Do not include markdown code block ticks, preambles, or postscripts.`;
}

export function buildSummaryUserPayload(
  captions: Array<Pick<CaptionItem, 'id' | 'startMs' | 'endMs' | 'source'>>
): string {
  const formatted = captions.map((c) => ({
    id: c.id,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.source,
  }));

  return JSON.stringify({
    captions: formatted,
  });
}
