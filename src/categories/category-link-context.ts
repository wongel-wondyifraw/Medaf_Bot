/**
 * Rich product context extracted from a SHEIN link/message for AI category
 * resolution. Sent to Gemini alongside the known category catalog.
 */
export interface CategoryLinkContext {
  title: string;
  url: string;
  slugTitle?: string;
  freeText?: string;
  productId?: string;
  domain?: string;
  imageUrl?: string;
}

export interface BuildCategoryLinkContextInput {
  title: string;
  url: string;
  rawMessage?: string;
  productId?: string | null;
  imageUrl?: string | null;
  slugTitle?: string | null;
  freeText?: string | null;
}

/**
 * Builds a CategoryLinkContext from manual-order inputs (free text, slug,
 * share preview, URL).
 */
export function buildCategoryLinkContext(
  input: BuildCategoryLinkContextInput,
): CategoryLinkContext {
  let domain: string | undefined;
  try {
    domain = new URL(input.url).hostname.toLowerCase();
  } catch {
    domain = undefined;
  }

  const ctx: CategoryLinkContext = {
    title: (input.title || '').trim(),
    url: input.url,
  };

  const slug = (input.slugTitle || '').trim();
  if (slug) ctx.slugTitle = slug;

  const free = (input.freeText || '').trim();
  if (free) ctx.freeText = free;

  const pid = (input.productId || '').trim();
  if (pid) ctx.productId = pid;

  if (domain) ctx.domain = domain;

  const img = (input.imageUrl || '').trim();
  if (img) ctx.imageUrl = img;

  return ctx;
}

/** Stable cache key for AI resolution (context + category set). */
export function categoryLinkContextCacheKey(
  ctx: CategoryLinkContext,
  categoryNames: string[],
): string {
  const parts = [
    categoryNames.join('|'),
    ctx.title.toLowerCase(),
    ctx.url,
    ctx.slugTitle?.toLowerCase() ?? '',
    ctx.productId ?? '',
    ctx.domain ?? '',
  ];
  return parts.join('::');
}
