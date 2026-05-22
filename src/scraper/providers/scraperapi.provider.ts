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

const SCRAPERAPI_BASE = 'https://api.scraperapi.com/';

const HOST_TO_COUNTRY: Record<string, string> = {
  'nl.shein.com': 'nl', 'be.shein.com': 'be', 'at.shein.com': 'at',
  'ie.shein.com': 'ie', 'fi.shein.com': 'fi', 'gr.shein.com': 'gr',
  'lu.shein.com': 'lu', 'es.shein.com': 'es', 'pt.shein.com': 'pt',
  'pl.shein.com': 'pl', 'de.shein.com': 'de', 'fr.shein.com': 'fr',
  'it.shein.com': 'it', 'ch.shein.com': 'ch', 'eur.shein.com': 'de',
  'roe.shein.com': 'no', 'no.shein.com': 'no', 'dk.shein.com': 'dk',
  'cz.shein.com': 'cz', 'hu.shein.com': 'hu', 'ro.shein.com': 'ro',
  'us.shein.com': 'us', 'www.shein.com': 'us', 'm.shein.com': 'us',
  'www.shein.co.uk': 'uk', 'uk.shein.com': 'uk', 'gb.shein.com': 'uk',
  'www.shein.se': 'se', 'se.shein.com': 'se',
};

@Injectable()
export class ScraperapiProvider implements ScrapeProvider {
  readonly label = 'ScraperAPI';
  readonly name = 'scraperapi' as const;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return !!this.config.get('scrape', { infer: true }).scraperapi.key;
  }

  private pickCountry(hostname: string): string {
    const host = hostname.toLowerCase();
    if (HOST_TO_COUNTRY[host]) return HOST_TO_COUNTRY[host];
    return this.config.get('scrape', { infer: true }).scraperapi.country || 'us';
  }

  private buildParams(apiKey: string, url: string, country: string): Record<string, string> {
    const mode = this.config.get('scrape', { infer: true }).scraperapi.mode;
    const params: Record<string, string> = {
      api_key: apiKey,
      url,
      country_code: country,
      output_format: 'markdown',
    };
    if (mode === 'ultra_premium') params.ultra_premium = 'true';
    else if (mode === 'premium') params.premium = 'true';
    else params.render = 'true';
    return params;
  }

  private interpretError(status: number, body: unknown): string {
    const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
    const lower = bodyText.toLowerCase();
    if (status === 401) return 'ScraperAPI rejected the API key (401). Check SCRAPERAPI_KEY in .env.';
    if (status === 429) return 'ScraperAPI rate limit hit (429). Try again in a moment.';
    if (status === 403) {
      if (/ultra.premium|premium/.test(lower)) {
        return 'ScraperAPI 403: ultra_premium/premium requested but not allowed on your plan. Set SCRAPERAPI_MODE=render in .env.';
      }
      if (/credit|quota|exceeded|limit/.test(lower)) {
        return 'ScraperAPI 403: account out of credits. Check your dashboard at scraperapi.com.';
      }
      if (/invalid|api.?key|unauthorized/.test(lower)) {
        return 'ScraperAPI 403: API key was rejected. Double-check SCRAPERAPI_KEY in .env.';
      }
      return `ScraperAPI 403: ${bodyText.slice(0, 200) || 'forbidden.'}`;
    }
    return `ScraperAPI failed (HTTP ${status}): ${bodyText.slice(0, 200)}`;
  }

  private extractPrice(markdown: string): { value: number; raw: string } | null {
    const text = markdown.replace(/\s+/g, ' ').slice(0, 20000);
    const priceRegex =
      /(?:€|\$|£|R\$|¥)\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:€|\$|£|R\$|¥|EUR|USD|GBP)/gi;
    const matches = text.match(priceRegex) || [];
    for (const m of matches) {
      const value = parsePriceValue(m);
      if (value != null && value >= 0.5) return { value, raw: m.trim() };
    }
    return null;
  }

  private extractTitle(markdown: string, url: string): string {
    const h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1 && h1[1].trim().length > 5) return h1[1].trim();
    const h2 = markdown.match(/^##\s+(.+)$/m);
    if (h2 && h2[1].trim().length > 5 && !/€|\$|£/.test(h2[1])) return h2[1].trim();
    const slug = url.match(/\/([^/?]+)-p-\d+\.html/i);
    if (slug) return slug[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return 'Unknown product';
  }

  private extractStock(markdown: string): boolean {
    const lower = markdown.toLowerCase();
    return !/out of stock|sold out|niet op voorraad|uitverkocht|ausverkauft|agotado|épuisé/.test(lower);
  }

  private extractProductId(url: string): string | null {
    const m = url.match(/-p-(\d+)\.html/i);
    return m ? m[1] : null;
  }

  private extractSizes(markdown: string): string[] {
    const m = markdown.match(/##\s+Size\s*\n([\s\S]*?)(?:Size Guide|##\s|ADD TO CART)/i);
    if (!m) return [];
    const seen = new Set<string>();
    const sizes: string[] = [];
    for (const rawLine of m[1].split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/please choose|fit finder|check my size|not your size|tell me/i.test(line)) continue;
      if (/^[![]/.test(line)) continue;
      if (line.length > 20) continue;
      const upper = line.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      sizes.push(line);
      if (sizes.length >= 30) break;
    }
    return sizes;
  }

  private extractBreadcrumb(markdown: string): string[] {
    const items: string[] = [];
    const lines = markdown.split('\n');
    let inList = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const m = line.match(/^\d+\.\s+(.+)$/);
      if (m) {
        let item = m[1].trim();
        const linkMatch = item.match(/^\[([^\]]+)\]\([^)]*\)/);
        if (linkMatch) item = linkMatch[1].trim();
        item = item.replace(/\s*\/\s*$/, '').trim();
        if (item && item.toLowerCase() !== 'home') items.push(item);
        inList = true;
        if (items.length >= 15) break;
      } else if (inList && line.length === 0) {
        continue;
      } else if (inList) {
        break;
      }
    }
    return items;
  }

  private extractColors(markdown: string): string[] {
    const m = markdown.match(
      /##\s+Color\s*:?[^\n]*\n([\s\S]*?)(?:##\s|CONFIRM|ADD TO CART|Description)/i,
    );
    if (!m) return [];
    const seen = new Set<string>();
    const colors: string[] = [];
    const re = /!\[([^\]]+)\]\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(m[1])) !== null) {
      const name = match[1].trim();
      if (!name) continue;
      if (/^(hot|trends|large image|fit finder|new|sale)$/i.test(name)) continue;
      if (/^\d/.test(name)) continue;
      if (name.length > 40) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(name);
      if (colors.length >= 30) break;
    }
    return colors;
  }

  async scrape(url: string): Promise<ScrapedProduct> {
    const cfg = this.config.get('scrape', { infer: true }).scraperapi;
    const apiKey = cfg.key;
    if (!apiKey) throw new Error('SCRAPERAPI_KEY is missing from .env.');

    const parsed = new URL(url);
    const country = this.pickCountry(parsed.hostname);
    const params = this.buildParams(apiKey, url, country);

    let body: string;
    try {
      const res = await axios.get<string>(SCRAPERAPI_BASE, {
        params,
        timeout: 90000,
        validateStatus: () => true,
      });
      if (res.status >= 400) throw new Error(this.interpretError(res.status, res.data));
      body = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.message && e.message.startsWith('ScraperAPI')) throw err;
      const code = e.code || '';
      if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
        const wrapped = new Error(`Network error reaching ScraperAPI (${code}).`);
        (wrapped as { code?: string }).code = code;
        throw wrapped;
      }
      throw new Error(`ScraperAPI request failed: ${e.message}`);
    }

    if (!body || body.length < 100) throw new Error('ScraperAPI returned an empty page.');

    const priceInfo = this.extractPrice(body);
    if (!priceInfo) throw new Error('ScraperAPI fetched the page but no price could be parsed.');

    return {
      title: this.extractTitle(body, url),
      price: priceInfo.value,
      priceRaw: priceInfo.raw,
      priceUsd: null,
      priceUsdRaw: null,
      originalPrice: null,
      originalPriceRaw: null,
      onSale: false,
      currency: inferCurrency(priceInfo.raw),
      inStock: this.extractStock(body),
      image: null,
      productId: this.extractProductId(url),
      domain: parsed.hostname.toLowerCase(),
      source: 'scraperapi',
      sizes: this.extractSizes(body),
      colors: this.extractColors(body),
      breadcrumb: this.extractBreadcrumb(body),
    };
  }
}
