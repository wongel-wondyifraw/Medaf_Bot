import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../../config/configuration';
import {
  inferCurrency,
  parsePriceValue,
  ScrapeProvider,
  ScrapedProduct,
} from '../types';

const RETAILED_BASE = 'https://app.retailed.io/api/v1/scraper/shein/product';

@Injectable()
export class RetailedProvider implements ScrapeProvider {
  readonly label = 'Retailed.io';
  readonly name = 'retailed' as const;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return !!this.config.get('scrape', { infer: true }).retailed.key;
  }

  private extractProductId(input: string): string | null {
    const m = String(input).match(/-p-(\d+)\.html/i);
    if (m) return m[1];
    if (/^\d+$/.test(input)) return input;
    return null;
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const apiKey = this.config.get('scrape', { infer: true }).retailed.key;
    if (!apiKey) throw new Error('RETAILED_API_KEY is missing from .env.');

    const productId = this.extractProductId(url);
    if (!productId) throw new Error('Could not extract product ID for Retailed.io.');

    let body: Record<string, unknown>;
    try {
      const res = await axios.get(RETAILED_BASE, {
        params: { productId },
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 60000,
        validateStatus: () => true,
      });
      if (res.status === 401 || res.status === 403) {
        const msg = typeof res.data === 'object'
          ? ((res.data as { message?: string }).message || JSON.stringify(res.data))
          : String(res.data);
        throw new Error(
          `Retailed.io rejected the request (HTTP ${res.status}): ${msg || 'access denied'}. ` +
          `Note: the Shein endpoint requires manual access approval at retailed.io.`,
        );
      }
      if (res.status === 402) throw new Error('Retailed.io: out of credits (402).');
      if (res.status === 429) throw new Error('Retailed.io rate limit hit (429).');
      if (res.status >= 400) {
        const msg = typeof res.data === 'object'
          ? JSON.stringify(res.data).slice(0, 300)
          : String(res.data).slice(0, 300);
        throw new Error(`Retailed.io failed (HTTP ${res.status}): ${msg}`);
      }
      body = res.data as Record<string, unknown>;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.message && e.message.startsWith('Retailed.io')) throw err;
      const code = e.code || '';
      if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
        const wrapped = new Error(`Network error reaching Retailed.io (${code}).`);
        (wrapped as { code?: string }).code = code;
        throw wrapped;
      }
      throw new Error(`Retailed.io request failed: ${e.message}`);
    }

    if (!body || typeof body !== 'object') {
      throw new Error('Retailed.io returned an empty or non-JSON response.');
    }

    const rawPrice = (body.price || body.salePrice || body.currentPrice) as
      | string
      | number
      | undefined;
    const priceValue = parsePriceValue(rawPrice);
    if (priceValue == null) throw new Error('Retailed.io response had no recognizable price.');

    const images = Array.isArray(body.images) ? (body.images as Array<{ url?: string } | string>) : [];
    const first = images[0];
    const firstImage = typeof first === 'string' ? first : first?.url || null;

    const sizesRaw = Array.isArray(body.sizes)
      ? (body.sizes as Array<string | { name?: string; label?: string }>)
      : [];
    const colorsRaw = Array.isArray(body.colors)
      ? (body.colors as Array<string | { name?: string; label?: string }>)
      : [];
    const sizes = sizesRaw
      .map((s) => (typeof s === 'string' ? s : s?.name || s?.label || ''))
      .filter((s): s is string => !!s && s.length > 0 && s.length <= 40);
    const colors = colorsRaw
      .map((c) => (typeof c === 'string' ? c : c?.name || c?.label || ''))
      .filter((c): c is string => !!c && c.length > 0 && c.length <= 40);

    return {
      title: String(body.name || body.title || 'Unknown product'),
      price: priceValue,
      priceRaw: typeof rawPrice === 'string' ? rawPrice : null,
      priceUsd: null,
      priceUsdRaw: null,
      originalPrice: parsePriceValue(body.originalPrice),
      originalPriceRaw: typeof body.originalPrice === 'string' ? (body.originalPrice as string) : null,
      onSale: !!body.onSale,
      currency: inferCurrency(typeof rawPrice === 'string' ? rawPrice : ''),
      inStock: body.inStock !== false,
      image: firstImage,
      productId,
      domain: new URL(url).hostname.toLowerCase(),
      source: 'retailed',
      sizes,
      colors,
    };
  }
}
