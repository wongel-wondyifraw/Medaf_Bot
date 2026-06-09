import {
  BroadGroup,
  DEFAULT_DUBAI_FACTOR_BY_GROUP,
} from '../calculator/broad-group';
import { CATEGORY_THREE_FACTOR_SEED, ThreeFactors } from './category-three-factors';
import { CategoryLinkContext } from './category-link-context';

/** Marker an AI model returns when no category fits the title. */
export const NONE_TOKEN = 'NONE';

export type CategoryResolveConfidence = 'high' | 'medium' | 'low';

export interface CategoryNewProposal {
  name: string;
  broadGroup: BroadGroup;
  dubaiFactorLow: number;
  dubaiFactorAvg: number;
  dubaiFactorHigh: number;
}

export type CategoryResolveResult =
  | { action: 'match'; category: string; confidence: CategoryResolveConfidence }
  | { action: 'create'; newCategory: CategoryNewProposal; confidence: CategoryResolveConfidence }
  | { action: 'none'; confidence: CategoryResolveConfidence };

const BROAD_GROUPS: BroadGroup[] = [
  'clothing',
  'shoes',
  'accessories',
  'beauty',
  'home',
];

const FACTOR_MIN = 0.25;
const FACTOR_MAX = 1.5;

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

function formatLinkContext(ctx: CategoryLinkContext): string {
  const lines = [`Product title: "${ctx.title}"`];
  if (ctx.slugTitle && ctx.slugTitle !== ctx.title) {
    lines.push(`URL slug title: "${ctx.slugTitle}"`);
  }
  if (ctx.freeText && ctx.freeText !== ctx.title) {
    lines.push(`User message text: "${ctx.freeText}"`);
  }
  if (ctx.productId) lines.push(`Product ID: ${ctx.productId}`);
  if (ctx.domain) lines.push(`Storefront domain: ${ctx.domain}`);
  lines.push(`Product URL: ${ctx.url}`);
  return lines.join('\n');
}

/**
 * Builds the enriched resolve prompt: link context + pricing categories +
 * match-or-create JSON schema.
 */
export function buildCategoryResolvePrompt(
  ctx: CategoryLinkContext,
  categoryNames: string[],
): string {
  const list = categoryNames.map((n) => `- ${n}`).join('\n');
  return [
    'You classify SHEIN products into exactly one delivery category for shipping and pricing.',
    '',
    'Product context:',
    formatLinkContext(ctx),
    '',
    'Existing delivery categories (use names verbatim when matching):',
    list,
    '',
    'Rules:',
    '- STRONGLY prefer matching an existing category when one fits.',
    '- Pick the category matching the actual product TYPE, not the occasion.',
    '  e.g. "Wedding Bride High Heel Sandals" is a heeled shoe, NOT a wedding dress.',
    '- A shoe with any heel/stiletto/wedge/pump wording is a heel shoe, not a flat.',
    '- Only propose a new category when no existing one fits.',
    '- New category names should be short product-type labels (2-4 words), not marketing copy.',
    '',
    'Respond ONLY with strict JSON using one of these shapes:',
    '{"action":"match","category":"<exact existing name>","confidence":"high|medium|low"}',
    '{"action":"create","newCategory":{"name":"<new name>","broadGroup":"clothing|shoes|accessories|beauty|home","dubaiFactorLow":0.35,"dubaiFactorAvg":0.68,"dubaiFactorHigh":1.10},"confidence":"high|medium|low"}',
    '{"action":"none","confidence":"low"}',
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

function parseConfidence(raw: unknown): CategoryResolveConfidence {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'medium';
}

function parseBroadGroup(raw: unknown): BroadGroup {
  if (typeof raw === 'string' && (BROAD_GROUPS as string[]).includes(raw)) {
    return raw as BroadGroup;
  }
  return 'clothing';
}

function parseFactor(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Parses Gemini resolve response into a structured match/create/none result.
 */
export function parseCategoryResolveAnswer(text: string): CategoryResolveResult | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;

  const confidence = parseConfidence(obj.confidence);
  const action = obj.action;

  if (action === 'match' && typeof obj.category === 'string') {
    const name = obj.category.trim();
    if (!name || name === NONE_TOKEN) {
      return { action: 'none', confidence };
    }
    return { action: 'match', category: name, confidence };
  }

  if (action === 'create' && obj.newCategory && typeof obj.newCategory === 'object') {
    const nc = obj.newCategory as Record<string, unknown>;
    const name = typeof nc.name === 'string' ? nc.name.trim() : '';
    if (!name) return null;
    const broadGroup = parseBroadGroup(nc.broadGroup);
    const factors = clampDubaiFactors(
      {
        low: parseFactor(nc.dubaiFactorLow),
        avg: parseFactor(nc.dubaiFactorAvg),
        high: parseFactor(nc.dubaiFactorHigh),
      },
      broadGroup,
    );
    return {
      action: 'create',
      confidence,
      newCategory: {
        name,
        broadGroup,
        dubaiFactorLow: factors.low,
        dubaiFactorAvg: factors.avg,
        dubaiFactorHigh: factors.high,
      },
    };
  }

  if (action === 'none') {
    return { action: 'none', confidence };
  }

  // Legacy {"category":"..."} shape from older classify flow
  if (typeof obj.category === 'string') {
    const name = obj.category.trim();
    if (!name || name === NONE_TOKEN) return { action: 'none', confidence };
    return { action: 'match', category: name, confidence };
  }

  return null;
}

/**
 * Validates/clamps Dubai factors. Enforces low <= avg <= high within bounds;
 * falls back to group defaults when values are missing or invalid.
 */
export function clampDubaiFactors(
  raw: { low: number | null; avg: number | null; high: number | null },
  broadGroup: BroadGroup,
): ThreeFactors {
  const groupDefault = DEFAULT_DUBAI_FACTOR_BY_GROUP[broadGroup];
  const seeded = Object.entries(CATEGORY_THREE_FACTOR_SEED).find(
    ([name]) => {
      const group =
        name.includes('shoe') || name.includes('Shoes')
          ? 'shoes'
          : name === 'Cosmetics'
            ? 'beauty'
            : ['Phone Cover', 'Bag(big)', 'Bag(small)', 'watch', 'Eye glass', 'Jewelery'].includes(name)
              ? 'accessories'
              : 'clothing';
      return group === broadGroup;
    },
  )?.[1];
  const fallback: ThreeFactors = seeded ?? {
    low: groupDefault * 0.85,
    avg: groupDefault,
    high: groupDefault * 1.15,
  };

  const clamp = (v: number | null, fb: number): number => {
    if (v == null || !Number.isFinite(v)) return fb;
    return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, v));
  };

  let low = clamp(raw.low, fallback.low);
  let avg = clamp(raw.avg, fallback.avg);
  let high = clamp(raw.high, fallback.high);

  if (low > avg) low = avg;
  if (avg > high) avg = high;
  if (low > avg) low = avg;

  return { low, avg, high };
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

/** Normalizes a proposed category name for DB storage. */
export function normalizeCategoryName(name: string): string {
  const trimmed = (name || '').trim().slice(0, 80);
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, ' ');
}

export function confidenceMeetsMinimum(
  confidence: CategoryResolveConfidence,
  minimum: CategoryResolveConfidence,
): boolean {
  const rank: Record<CategoryResolveConfidence, number> = {
    low: 0,
    medium: 1,
    high: 2,
  };
  return rank[confidence] >= rank[minimum];
}
