export interface ScrapedProduct {
  title: string;
  price: number;
  priceRaw: string | null;
  priceUsd: number | null;
  priceUsdRaw: string | null;
  originalPrice: number | null;
  originalPriceRaw: string | null;
  onSale: boolean;
  currency: string | null;
  inStock: boolean;
  image: string | null;
  productId: string | null;
  domain: string;
  source?: string;
  sizes: string[];
  colors: string[];
}

export interface ScrapeProvider {
  readonly label: string;
  readonly name: 'scraperapi' | 'retailed' | 'searchapi';
  isConfigured(): boolean;
  scrape(url: string): Promise<ScrapedProduct>;
}

export function parseShein(url: string): { productId: string; domain: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  if (!/shein\.com$/i.test(parsed.hostname)) throw new Error('URL is not a shein.com link.');
  const idMatch = parsed.pathname.match(/-p-(\d+)\.html$/i);
  if (!idMatch) {
    throw new Error(
      'Could not find the product ID in the URL. Make sure you sent a product detail page (ends with "-p-<number>.html").',
    );
  }
  return { productId: idMatch[1], domain: parsed.hostname.toLowerCase() };
}

export function inferCurrency(rawPrice: string | null | undefined): string | null {
  if (typeof rawPrice !== 'string') return null;
  if (rawPrice.includes('€')) return 'EUR';
  if (rawPrice.includes('£')) return 'GBP';
  if (/R\$/.test(rawPrice)) return 'BRL';
  if (rawPrice.includes('¥')) return 'JPY';
  if (rawPrice.includes('$')) return 'USD';
  return null;
}

export function parsePriceValue(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}
