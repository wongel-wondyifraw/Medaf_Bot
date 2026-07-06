import { Injectable, Logger } from '@nestjs/common';
import { linkInvalidReasons } from '../i18n/reseller-messages';
import {
  extractSheinUrlFromText,
  isKnownShareStyleLink,
  isSheinHostname,
  matchSheinLinkType,
} from './shein-link-types';

/**
 * Result of classifying a user-supplied SHEIN message. Currently every
 * valid SHEIN link (desktop, mobile, share, one-link, …) is routed through
 * the manual order flow — the scraping providers remain in the codebase but
 * are intentionally not invoked.
 */
export type LinkClassification =
  | { kind: 'scrape'; url: string }
  | { kind: 'manual'; url: string; productId: string | null; reason: string }
  | { kind: 'invalid'; reason: string };

@Injectable()
export class LinkResolverService {
  private readonly logger = new Logger(LinkResolverService.name);

  isProductUrl(url: string): boolean {
    const match = matchSheinLinkType(url);
    return match?.typeId === 'product-page';
  }

  resolve(input: string): string {
    const url = extractSheinUrlFromText(input);
    if (!url) {
      throw new Error('No URL found in your message. Please send a SHEIN product link.');
    }

    const match = matchSheinLinkType(url);
    if (match?.typeId === 'product-page') {
      this.logger.log(`Got product URL: ${match.url}`);
      return match.url;
    }

    if (match && isKnownShareStyleLink(url)) {
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
          '',
          'You can also send the share message as-is — the bot will use the product title from your message.',
        ].join('\n'),
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('That does not look like a valid URL.');
    }

    if (isSheinHostname(parsed.hostname)) {
      throw new Error(
        'That SHEIN link is not a recognized product or share format. ' +
          'Send a product page URL (ends with "-p-<number>.html") or a supported SHEIN share link.',
      );
    }

    throw new Error('That URL does not look like a SHEIN link.');
  }

  /**
   * Classify the user's input into the next bot action. Unlike resolve(),
   * this never throws — it returns a discriminated result the bot can use
   * to branch between the scraping flow and the manual flow.
   */
  classify(input: string): LinkClassification {
    const url = extractSheinUrlFromText(input);
    if (!url) {
      return { kind: 'invalid', reason: linkInvalidReasons.noUrl() };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: 'invalid', reason: linkInvalidReasons.invalidUrl() };
    }

    if (!isSheinHostname(parsed.hostname)) {
      return { kind: 'invalid', reason: linkInvalidReasons.notSheinHost() };
    }

    const match = matchSheinLinkType(url);
    if (!match) {
      return { kind: 'invalid', reason: linkInvalidReasons.notProductPage() };
    }

    this.logger.log(
      `SHEIN link type=${match.typeId} productId=${match.productId ?? 'n/a'} url=${match.url}`,
    );

    return {
      kind: 'manual',
      url: match.url,
      productId: match.productId,
      reason: match.label,
    };
  }
}
