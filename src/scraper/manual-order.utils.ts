/**
 * Helpers used when building an order from a SHEIN link manually.
 */

import type { SharePreviewResult } from './share-preview.service';
import { matchSheinLinkType } from './shein-link-types';

/**
 * Extracts numeric product ID from a SHEIN product URL (-p-ID.html).
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
