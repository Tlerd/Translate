import 'server-only';

export interface ImagePromptSummaryData {
  title: string;
  overview: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
}

export function buildImageIllustrationPrompt(data: ImagePromptSummaryData): string {
  const points = data.sections
    .map((s) => `${s.heading}: ${s.bullets.slice(0, 2).join('; ')}`)
    .slice(0, 3)
    .join(' | ');

  return `Create a clean, elegant modern educational concept illustration for a learning session titled: "${data.title}".
Context summary: ${data.overview}
Key topics: ${points}.
Style: High quality vector-style educational concept art, warm harmonious color palette, balanced composition, no cluttered small text, no logos, clear symbolic visual representations of the topics.`;
}
