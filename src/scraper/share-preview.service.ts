import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface SharePreviewResult {
  title: string;
  image: string | null;
  productId: string | null;
}

const MAX_BODY_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 6000;

@Injectable()
export class SharePreviewService {
  private readonly logger = new Logger(SharePreviewService.name);

  /**
   * Fetches a SHEIN share/product URL and extracts link-preview metadata
   * (title, image, product id) from the HTML head — the same data Telegram
   * uses to render its in-chat preview. Returns null on any failure.
   */
  async tryFetch(url: string): Promise<SharePreviewResult | null> {
    if (!this.isAllowedSheinUrl(url)) {
      this.logger.warn(`Share preview blocked for non-SHEIN host: ${url}`);
      return null;
    }

    try {
      const res = await axios.get<string>(url, {
        timeout: FETCH_TIMEOUT_MS,
        maxRedirects: 5,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        transformResponse: [(data) => this.truncateToHead(data)],
      });

      if (res.status < 200 || res.status >= 400) {
        this.logger.warn(`Share preview HTTP ${res.status} for ${url}`);
        return null;
      }

      const contentType = String(res.headers['content-type'] || '');
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        this.logger.warn(`Share preview non-HTML content-type for ${url}: ${contentType}`);
        return null;
      }

      const html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      if (html.length < 50) {
        this.logger.warn(`Share preview empty/short body for ${url}`);
        return null;
      }

      const title = this.extractTitle(html);
      if (!title || title.length < 4) {
        this.logger.warn(`Share preview no title parsed for ${url}`);
        return null;
      }

      const image = this.extractOgImage(html);
      const productId = this.extractProductId(html);

      this.logger.log(
        `Share preview ok title="${title.slice(0, 60)}" productId=${productId ?? 'n/a'}`,
      );

      return { title, image, productId };
    } catch (err) {
      const e = err as Error;
      this.logger.warn(`Share preview failed for ${url}: ${e.message}`);
      return null;
    }
  }

  private isAllowedSheinUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return /(^|\.)shein\.com$/i.test(host) || /(^|\.)shein\.top$/i.test(host);
    } catch {
      return false;
    }
  }

  private truncateToHead(data: unknown): string {
    const raw = typeof data === 'string' ? data : String(data ?? '');
    if (raw.length > MAX_BODY_BYTES) {
      const sliced = raw.slice(0, MAX_BODY_BYTES);
      const headEnd = sliced.search(/<\/head>/i);
      return headEnd >= 0 ? sliced.slice(0, headEnd + 7) : sliced;
    }
    const headEnd = raw.search(/<\/head>/i);
    if (headEnd >= 0 && headEnd < raw.length) {
      return raw.slice(0, headEnd + 7);
    }
    return raw;
  }

  private extractTitle(html: string): string | null {
    const og = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) ?? html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    );
    if (og?.[1]) {
      const title = this.decodeHtmlEntities(og[1].trim());
      if (title.length >= 4 && !/^shein\s*(?:\.com)?$/i.test(title)) return title;
    }

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag?.[1]) {
      const title = this.decodeHtmlEntities(titleTag[1].trim());
      if (title.length >= 4 && !/^shein\s*(?:\.com)?$/i.test(title)) return title;
    }

    return null;
  }

  private extractOgImage(html: string): string | null {
    const m =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      );
    if (!m?.[1]) return null;
    const image = m[1].trim();
    if (!/^https?:\/\//i.test(image)) return null;
    return image.replace(/^http:\/\//i, 'https://');
  }

  private extractProductId(html: string): string | null {
    const m = html.match(/-p-(\d+)\.html/i);
    return m ? m[1] : null;
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/\s+/g, ' ')
      .trim();
  }
}
