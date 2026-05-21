import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig, ScrapeProviderName } from '../config/configuration';
import { parseShein, ScrapeProvider, ScrapedProduct } from './types';
import { LinkResolverService } from './link-resolver.service';
import { ScraperapiProvider } from './providers/scraperapi.provider';
import { RetailedProvider } from './providers/retailed.provider';
import { SearchapiProvider } from './providers/searchapi.provider';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly registry: Record<ScrapeProviderName, ScrapeProvider>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly linkResolver: LinkResolverService,
    scraperapi: ScraperapiProvider,
    retailed: RetailedProvider,
    searchapi: SearchapiProvider,
  ) {
    this.registry = { scraperapi, retailed, searchapi };
  }

  private resolveOrder(): ScrapeProvider[] {
    const order = this.config.get('scrape', { infer: true }).providerOrder;
    const list: ScrapeProvider[] = [];
    for (const name of order) {
      const p = this.registry[name];
      if (p && p.isConfigured()) list.push(p);
    }
    return list;
  }

  async scrapeProduct(input: string): Promise<ScrapedProduct> {
    const url = this.linkResolver.resolve(input);
    parseShein(url);

    const providers = this.resolveOrder();
    if (providers.length === 0) {
      throw new Error(
        'No scraping provider configured. Add at least one of: SCRAPERAPI_KEY, RETAILED_API_KEY, SEARCHAPI_KEY to .env.',
      );
    }

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        this.logger.log(`Trying provider: ${provider.label}`);
        return await provider.scrape(url);
      } catch (err) {
        const e = err as Error;
        this.logger.warn(`${provider.label} failed: ${e.message}`);
        errors.push(`${provider.label}: ${e.message}`);
      }
    }

    throw new Error(
      `All scraping providers failed.\n${errors.map((line) => '- ' + line).join('\n')}`,
    );
  }
}
