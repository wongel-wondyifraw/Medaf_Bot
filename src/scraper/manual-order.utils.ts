/**
 * Helpers used when the bot decides to build an order from a SHEIN link
 * manually (no scraping). Used for mobile (m.shein.com) URLs, SHEIN one-link
 * URLs (onelink.shein.com), and legacy share links (api-shein.shein.com/sharejump,
 * shein.top, …) where scraping providers are unreliable.
 */

import type { SharePreviewResult } from './share-preview.service';
import { matchSheinLinkType } from './shein-link-types';

export const DEFAULT_CLOTHING_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

/**
 * Words that, when present in a product title, indicate it is wearable
 * clothing — in which case the bot offers a size selection step. Keep the
 * list specific enough that ordinary descriptors ("set", "casual") do not
 * over-match.
 */
const CLOTHING_KEYWORDS = [
  'dress', 'cloth', 'shirt', 'blouse', 'tee', 't-shirt', 'tank', 'top',
  'pants', 'trousers', 'jeans', 'leggings', 'shorts',
  'sweatpants', 'trackpants', 'jogpants', 'cargopants',
  'skirt', 'skirts',
  'jacket', 'coat', 'blazer', 'cardigan', 'sweater', 'hoodie', 'sweatshirt',
  'pullover', 'jumper',
  'jumpsuit', 'romper', 'bodysuit', 'overall',
  'bra', 'lingerie', 'pajama', 'pyjama', 'sleepwear', 'robe', 'nightgown',
  'bikini', 'swimsuit', 'swimwear',
  'polo', 'tracksuit', 'uniform',
];

/**
 * Boilerplate text that SHEIN's share sheet adds before/around the actual
 * product name when a user shares from the app. Stripping these makes the
 * remaining free text usable as a product title.
 */
const SHARE_BOILERPLATE_PATTERNS: RegExp[] = [
  /i\s+(?:discovered|found)\s+(?:amazing|this)\s+products?\s+on\s+shein\.com[^\n]*/gi,
  /come\s+check\s+(?:them|it)\s+out!?/gi,
  /check\s+out\s+this\s+product\s+on\s+shein!?/gi,
];

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

export function isClothingTitle(productTitle: string): boolean {
  if (!productTitle) return false;
  const lower = productTitle.toLowerCase();
  return CLOTHING_KEYWORDS.some((kw) =>
    new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(lower),
  );
}

/**
 * Returns the remaining text after stripping URLs and known SHEIN share
 * boilerplate. Useful for turning a forwarded SHEIN share message into a
 * product title.
 */
export function extractFreeText(input: string): string {
  if (!input) return '';
  let cleaned = input.replace(URL_REGEX, ' ');
  for (const pattern of SHARE_BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleaned.replace(/[\u2026]/g, ' '); // ellipsis
  cleaned = cleaned.replace(/[\s\r\n]+/g, ' ').trim();
  // Trim trailing punctuation/separators left after stripping
  cleaned = cleaned.replace(/^[\s\-:|,.]+|[\s\-:|,.]+$/g, '');
  return cleaned;
}

/**
 * For SHEIN product URLs (m./us./etc) the slug before -p-ID.html is a
 * human-readable name like "Tween-Girls-Letter-Print-...". Convert it to
 * title-case "Tween Girls Letter Print …".
 */
export function extractProductIdFromUrl(url: string): string | null {
  try {
    return url.match(/-p-(\d+)\.html/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface ResolvedManualProduct {
  productTitle: string;
  productId: string | null;
  orderLink: string;
  imageUrl: string | null;
  slugTitle: string | null;
}

/** Prefer normalized product-page URL when redirects resolve to one. */
export function pickOrderLinkFromResolution(
  inputUrl: string,
  canonicalUrl: string | null,
): string {
  const candidates = [canonicalUrl, inputUrl].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  for (const candidate of candidates) {
    const match = matchSheinLinkType(candidate);
    if (match?.typeId === 'product-page') return match.url;
  }
  return canonicalUrl ?? inputUrl;
}

/**
 * Builds product title, id, and stored link from HTTP share preview (redirects +
 * og tags) — not from pasted message text.
 */
export function resolveManualProductFromLink(
  inputUrl: string,
  classifiedProductId: string | null,
  preview: SharePreviewResult | null,
): ResolvedManualProduct | null {
  if (!preview) return null;

  const canonicalUrl = preview.canonicalUrl || inputUrl;
  const orderLink = pickOrderLinkFromResolution(inputUrl, canonicalUrl);
  const slugTitle =
    extractSlugTitle(canonicalUrl) ??
    extractSlugTitle(orderLink) ??
    extractSlugTitle(inputUrl);
  const productId =
    classifiedProductId ??
    preview.productId ??
    extractProductIdFromUrl(canonicalUrl) ??
    extractProductIdFromUrl(orderLink) ??
    extractProductIdFromUrl(inputUrl);

  const productTitle =
    (preview.title && preview.title.length >= 4 ? preview.title : null) ??
    slugTitle ??
    (productId ? `SHEIN product ${productId}` : null);

  if (!productTitle) return null;

  return {
    productTitle,
    productId,
    orderLink,
    imageUrl: preview.image,
    slugTitle,
  };
}

/**
 * For SHEIN product URLs (m./us./etc) the slug before -p-ID.html is a
 * human-readable name like "Tween-Girls-Letter-Print-...". Convert it to
 * title-case "Tween Girls Letter Print …".
 */
export function extractSlugTitle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const m = parsed.pathname.match(/\/([^/?]+)-p-\d+\.html$/i);
  if (!m) return null;

  // SHEIN slugs encode the apostrophe in possessives as "-s-" (e.g.
  // "Men-s-Linen-Pants"). Restore it before stripping the remaining
  // dashes so we don't end up with "Men S Linen Pants".
  const raw = m[1]
    .replace(/-s-/gi, "'s-")
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;

  // Title-case only at the start of each space-delimited word so apostrophes
  // do not trigger an unwanted "Men'S" capitalization.
  return raw.replace(/(^|\s)([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
