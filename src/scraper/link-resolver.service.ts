import { Injectable, Logger } from '@nestjs/common';
import { linkInvalidReasons } from '../i18n/reseller-messages';
import {
  extractSheinUrlFromText,
  isSheinHostname,
  matchSheinLinkType,
} from './shein-link-types';

/**
 * Result of classifying a user-supplied SHEIN message. Every valid SHEIN link
 * (desktop, mobile, share, one-link, …) is routed through the manual order flow.
 */
export type LinkClassification =
  | { kind: 'manual'; url: string; productId: string | null; reason: string }
  | { kind: 'invalid'; reason: string };

@Injectable()
export class LinkResolverService {
  private readonly logger = new Logger(LinkResolverService.name);

  /**
   * Classify the user's input into the next bot action.
   * Never throws — returns a discriminated result.
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
