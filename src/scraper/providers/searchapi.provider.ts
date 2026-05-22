import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../../config/configuration';
import {
  inferCurrency,
  parsePriceValue,
  parseShein,
  ScrapeProvider,
  ScrapedProduct,
} from '../types';

const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';

const SUPPORTED_DOMAINS = new Set([
  'us.shein.com', 'roe.shein.com', 'de.shein.com', 'eur.shein.com',
  'fr.shein.com', 'it.shein.com', 'ch.shein.com', 'pl.shein.com',
  'pt.shein.com', 'es.shein.com', 'www.shein.se', 'www.shein.co.uk',
]);

const DOMAIN_ALIASES: Record<string, string> = {
  'nl.shein.com': 'eur.shein.com', 'be.shein.com': 'eur.shein.com',
  'at.shein.com': 'de.shein.com', 'ie.shein.com': 'eur.shein.com',
  'fi.shein.com': 'eur.shein.com', 'gr.shein.com': 'eur.shein.com',
  'lu.shein.com': 'eur.shein.com', 'cz.shein.com': 'eur.shein.com',
  'no.shein.com': 'eur.shein.com', 'dk.shein.com': 'eur.shein.com',
  'se.shein.com': 'www.shein.se', 'uk.shein.com': 'www.shein.co.uk',
  'gb.shein.com': 'www.shein.co.uk', 'www.shein.com': 'us.shein.com',
  'm.shein.com': 'us.shein.com',
};

@Injectable()
export class SearchapiProvider implements ScrapeProvider {
  readonly label = 'SearchAPI.io';
  readonly name = 'searchapi' as const;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return !!this.config.get('scrape', { infer: true }).searchapi.key;
  }

  private mapDomain(domain: string): string {
    const lower = (domain || '').toLowerCase();
    if (SUPPORTED_DOMAINS.has(lower)) return lower;
    if (DOMAIN_ALIASES[lower]) return DOMAIN_ALIASES[lower];
    return 'eur.shein.com';
  }

  private async tryDomain(
    apiKey: string,
    productId: string,
    domain: string,
    currency: string,
  ): Promise<ScrapedProduct | { error: string }> {
    const params: Record<string, string> = {
      api_key: apiKey,
      engine: 'shein_product',
      product_id: productId,
      shein_domain: domain,
    };
    if (currency) params.shein_currency = currency.toUpperCase();

    try {
      const res = await axios.get(SEARCHAPI_BASE, {
        params,
        timeout: 60000,
        validateStatus: () => true,
      });
      if (res.status >= 400) {
        const msg = typeof res.data === 'object'
          ? ((res.data as { error?: string; message?: string }).error ||
             (res.data as { message?: string }).message ||
             JSON.stringify(res.data))
          : String(res.data);
        return { error: `HTTP ${res.status}: ${msg}` };
      }
      const product = (res.data as { product?: Record<string, unknown> }).product;
      if (!product || typeof product !== 'object') {
        return { error: 'response missing `product` field' };
      }

      const priceUsd = parsePriceValue(product.price_usd);
      const priceLocal = parsePriceValue(product.price);
      const value = priceLocal ?? priceUsd;
      if (value == null) return { error: 'no recognizable price' };

      const imgs = Array.isArray(product.images) ? (product.images as Array<{ url?: string } | string>) : [];
      const first = imgs[0];
      const firstImage = typeof first === 'string' ? first : first?.url || null;

      const sizesRaw = Array.isArray(product.sizes)
        ? (product.sizes as Array<string | { name?: string; label?: string }>)
        : [];
      const colorsRaw = Array.isArray(product.colors)
        ? (product.colors as Array<string | { name?: string; label?: string }>)
        : [];
      const sizes = sizesRaw
        .map((s) => (typeof s === 'string' ? s : s?.name || s?.label || ''))
        .filter((s): s is string => !!s && s.length > 0 && s.length <= 40);
      const colors = colorsRaw
        .map((c) => (typeof c === 'string' ? c : c?.name || c?.label || ''))
        .filter((c): c is string => !!c && c.length > 0 && c.length <= 40);

      return {
        title: String(product.name || product.title || 'Unknown product'),
        price: value,
        priceRaw: typeof product.price === 'string' ? (product.price as string) : null,
        priceUsd,
        priceUsdRaw: typeof product.price_usd === 'string' ? (product.price_usd as string) : null,
        originalPrice: parsePriceValue(product.original_price),
        originalPriceRaw: typeof product.original_price === 'string' ? (product.original_price as string) : null,
        onSale: !!product.on_sale,
        currency: (product.currency as string) || inferCurrency(String(product.price || '')),
        inStock: product.in_stock !== false,
        image: firstImage,
        productId,
        domain,
        source: 'searchapi',
        sizes,
        colors,
      };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const code = e.code || '';
      if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
        return { error: `network ${code}` };
      }
      return { error: e.message || 'unknown error' };
    }
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const cfg = this.config.get('scrape', { infer: true }).searchapi;
    const apiKey = cfg.key;
    if (!apiKey) throw new Error('SEARCHAPI_KEY is missing from .env.');

    const { productId, domain } = parseShein(url);
    const initial = cfg.domain ? this.mapDomain(cfg.domain) : this.mapDomain(domain);
    const fallbacks = ['eur.shein.com', 'de.shein.com', 'us.shein.com'].filter((d) => d !== initial);
    const candidates = [initial, ...fallbacks];

    const errors: string[] = [];
    for (const d of candidates) {
      const result = await this.tryDomain(apiKey, productId, d, cfg.currency);
      if ('error' in result) errors.push(`${d}: ${result.error}`);
      else return result;
    }
    throw new Error(
      `SearchAPI failed across all supported domains.\n${errors.map((e) => '- ' + e).join('\n')}`,
    );
  }
}
