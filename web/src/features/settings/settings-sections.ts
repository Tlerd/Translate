/** A section's top edge, measured from the top of the scrolling settings page in CSS pixels. */
export interface SectionPosition {
  readonly id: string;
  readonly top: number;
}

/**
 * Picks the settings section that owns the reading line. A section owns the line once its top has
 * passed it, so the last such section in document order wins. The first section is the fallback
 * above every section. At the bottom of the page the last section wins, because a short final
 * section never reaches the line.
 */
export function pickActiveSection(
  positions: readonly SectionPosition[],
  lineY: number,
  atEnd: boolean
): string | null {
  if (positions.length === 0) return null;
  if (atEnd) return positions[positions.length - 1].id;
  let active = positions[0].id;
  for (const position of positions) {
    if (position.top <= lineY) active = position.id;
  }
  return active;
}
