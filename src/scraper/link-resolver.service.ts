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
      this.logger.log(`Got product URL: ${url}`);
      return url;
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
