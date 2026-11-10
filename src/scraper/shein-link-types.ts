/**
 * Registry of known SHEIN URL shapes. When SHEIN ships a new share/deep-link
 * format, add a provider here — no other files need to change.
 *
 * Each provider is checked in priority order (highest first). The first match
 * wins. Product-detail pages (-p-ID.html) are preferred over share/deep links
 * when a message contains multiple URLs.
 */

export type SheinLinkFlow = 'manual';

export interface SheinLinkTypeMatch {
  typeId: string;
  label: string;
  flow: SheinLinkFlow;
  url: string;
  productId: string | null;
}

export interface SheinLinkTypeProvider {
  readonly id: string;
  readonly label: string;
  readonly priority: number;
  readonly flow: SheinLinkFlow;
  matches(parsed: URL, rawUrl: string): boolean;
  extractProductId?(parsed: URL, rawUrl: string): string | null;
  normalize?(rawUrl: string): string;
}

function hostMatches(host: string, pattern: RegExp): boolean {
  return pattern.test(host.toLowerCase());
}

/** Standard product detail page: …-p-12345678.html */
const productPageProvider: SheinLinkTypeProvider = {
  id: 'product-page',
  label: 'SHEIN product link',
  priority: 100,
  flow: 'manual',
  matches(parsed) {
    return (
      hostMatches(parsed.hostname, /(^|\.)shein\.com$/) &&
      /-p-\d+\.html$/i.test(parsed.pathname)
    );
  },
  extractProductId(parsed) {
    return parsed.pathname.match(/-p-(\d+)\.html$/i)?.[1] ?? null;
  },
  normalize(rawUrl) {
    const u = new URL(rawUrl);
    u.search = '';
    u.hash = '';
    return u.toString();
  },
};

/**
 * App one-link deep links, e.g.
 * https://onelink.shein.com/41/5uvloicgzal3
 */
const oneLinkProvider: SheinLinkTypeProvider = {
  id: 'onelink',
  label: 'SHEIN one-link',
  priority: 90,
  flow: 'manual',
  matches(parsed) {
    if (parsed.hostname.toLowerCase() !== 'onelink.shein.com') return false;
    const path = parsed.pathname.replace(/\/+$/, '');
    return /^\/[^/]+(?:\/[^/]+)?$/i.test(path);
  },
};

const apiShareProvider: SheinLinkTypeProvider = {
  id: 'api-share',
  label: 'SHEIN share link',
  priority: 80,
  flow: 'manual',
  matches(parsed) {
    return parsed.hostname.toLowerCase() === 'api-shein.shein.com';
  },
};

const sheinTopProvider: SheinLinkTypeProvider = {
  id: 'shein-top',
  label: 'SHEIN share link',
  priority: 80,
  flow: 'manual',
  matches(parsed) {
    return hostMatches(parsed.hostname, /(^|\.)shein\.top$/);
  },
};

const sharePathProvider: SheinLinkTypeProvider = {
  id: 'share-path',
  label: 'SHEIN share link',
  priority: 70,
  flow: 'manual',
  matches(parsed) {
    const path = parsed.pathname.toLowerCase();
    return /sharejump|appjump|\/share\//i.test(path);
  },
};

/**
 * Add new SHEIN URL formats here. Keep priority higher than generic fallbacks.
 * Document the example URL in a comment above each provider.
 */
export const SHEIN_LINK_TYPE_PROVIDERS: readonly SheinLinkTypeProvider[] = [
  productPageProvider,
  oneLinkProvider,
  apiShareProvider,
  sheinTopProvider,
  sharePathProvider,
].sort((a, b) => b.priority - a.priority);

export function isSheinHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return /(^|\.)shein\.com$/i.test(host) || /(^|\.)shein\.top$/i.test(host);
}

export function isProductDetailUrl(url: string): boolean {
  return matchSheinLinkType(url)?.typeId === 'product-page';
}

export function matchSheinLinkType(url: string): SheinLinkTypeMatch | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!isSheinHostname(parsed.hostname)) return null;

  for (const provider of SHEIN_LINK_TYPE_PROVIDERS) {
    if (!provider.matches(parsed, url)) continue;
    const normalized = provider.normalize?.(url) ?? url;
    const productId = provider.extractProductId?.(parsed, url) ?? null;
    let label = provider.label;
    if (
      provider.id === 'product-page' &&
      parsed.hostname.toLowerCase() === 'm.shein.com'
    ) {
      label = 'SHEIN mobile link';
    }
    return {
      typeId: provider.id,
      label,
      flow: provider.flow,
      url: normalized,
      productId,
    };
  }

  return null;
}

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Pulls the best SHEIN URL from user text. Prefers product pages, then other
 * known link types, then any SHEIN host.
 */
export function extractSheinUrlFromText(input: string): string | null {
  const matches = input.match(URL_IN_TEXT_REGEX);
  if (!matches?.length) return null;

  const productHit = matches.find((m) => isProductDetailUrl(m));
  if (productHit) return productHit;

  const typedHit = matches.find((m) => matchSheinLinkType(m) != null);
  if (typedHit) return typedHit;

  return matches.find((m) => {
    try {
      return isSheinHostname(new URL(m).hostname);
    } catch {
      return false;
    }
  }) ?? null;
}
