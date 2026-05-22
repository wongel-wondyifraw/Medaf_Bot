import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LinkResolverService {
  private readonly logger = new Logger(LinkResolverService.name);

  isProductUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return /shein/i.test(u.hostname) && /-p-\d+\.html$/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  private normalizeProductUrl(url: string): string {
    const u = new URL(url);

    // Drop the tracking/share query (src_identifier, detailBusinessFrom, …).
    // Those params come from the SHEIN app/share sheet and make the page
    // slower to render on ScraperAPI. We intentionally do NOT rewrite the
    // hostname: rewriting m.shein.com to us.shein.com produces a slug that
    // may not exist on the US storefront, which causes SHEIN to serve a
    // redirect/soft-404 and ScraperAPI to burn its full 90s render budget.
    // The ScraperAPI provider already maps m.shein.com to country=us, so the
    // mobile host scrapes correctly as-is.
    u.search = '';
    u.hash = '';
    return u.toString();
  }

  private isSheinHost(url: string): boolean {
    try {
      const u = new URL(url);
      return /(^|\.)shein\.com$/i.test(u.hostname) || /(^|\.)shein\.top$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  private isShareLink(url: string): boolean {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (host === 'api-shein.shein.com') return true;
      if (/(^|\.)shein\.top$/i.test(host)) return true;
      if (/sharejump|appjump|\/share\//i.test(path)) return true;
      return false;
    } catch {
      return false;
    }
  }

  private extractUrl(input: string): string | null {
    const matches = input.match(/https?:\/\/[^\s<>"'`]+/gi);
    if (!matches) return null;
    const productHit = matches.find((m) => this.isProductUrl(m));
    if (productHit) return productHit;
    const sheinHit = matches.find((m) => this.isSheinHost(m));
    if (sheinHit) return sheinHit;
    return matches[0];
  }

  resolve(input: string): string {
    const url = this.extractUrl(input);
    if (!url) {
      throw new Error('No URL found in your message. Please send a SHEIN product link.');
    }

    if (this.isProductUrl(url)) {
      const normalized = this.normalizeProductUrl(url);
      this.logger.log(
        normalized === url
          ? `Got product URL: ${url}`
          : `Normalized product URL: ${url} -> ${normalized}`,
      );
      return normalized;
    }

    if (this.isShareLink(url)) {
      throw new Error(
        [
          "That's a SHEIN app share link, which can't be priced directly.",
          '',
          'How to get a working link:',
          '1. Open the share link in your browser.',
          '2. Wait for the product page to fully load.',
          '3. Tap the share / copy URL button (or copy from the address bar).',
          '4. Send that URL to the bot.',
          '',
          'Example of a working URL:',
          'https://us.shein.com/Some-Product-Name-p-12345678.html',
        ].join('\n'),
      );
    }

    if (this.isSheinHost(url)) {
      throw new Error(
        'That SHEIN link is not a product page. Please send the URL of the product detail page, ' +
          'which ends with "-p-<number>.html".',
      );
    }

    throw new Error('That URL does not look like a SHEIN link.');
  }
}
