/** Marker an AI model returns when no category fits the title. */
export const NONE_TOKEN = 'NONE';

/**
 * Builds the shared classification prompt used by every AI provider so they
 * follow identical business rules (product type beats occasion, heel beats
 * flat) and return the same strict-JSON shape.
 */
export function buildCategoryPrompt(
  title: string,
  categoryNames: string[],
): string {
  const list = categoryNames.map((n) => `- ${n}`).join('\n');
  return [
    'You classify SHEIN product titles into exactly one delivery category.',
    'Choose the single best category from this list (use the names verbatim):',
    list,
    '',
    'Rules:',
    '- Pick the category matching the actual product TYPE, not the occasion.',
    '  e.g. "Wedding Bride High Heel Sandals" is a heeled shoe, NOT a wedding dress.',
    '- A shoe with any heel/stiletto/wedge/pump wording is a heel shoe, not a flat.',
    `- If nothing fits, respond with "${NONE_TOKEN}".`,
    '',
    `Product title: "${title}"`,
    '',
    'Respond ONLY with strict JSON: {"category": "<exact name or NONE>"}',
  ].join('\n');
}

/**
 * Parses a model's raw text answer into a category name. Handles strict JSON
 * and the common case where a model wraps JSON in prose. Returns null when no
 * category string can be recovered.
 */
export function parseCategoryAnswer(text: string): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { category?: unknown };
    if (typeof parsed.category === 'string') return parsed.category.trim();
  } catch {
    const match = trimmed.match(/"category"\s*:\s*"([^"]*)"/);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Validates a model answer against the known category set, treating the
 * NONE marker and unknown names as "no match" (null).
 */
export function resolveCategoryAnswer(
  answer: string | null,
  validNames: Set<string>,
): string | null {
  if (!answer || answer === NONE_TOKEN) return null;
  return validNames.has(answer) ? answer : null;
}
