import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScraperService } from './scraper.service';
import { LinkResolverService } from './link-resolver.service';
import { ScraperapiProvider } from './providers/scraperapi.provider';
import { RetailedProvider } from './providers/retailed.provider';
import { SearchapiProvider } from './providers/searchapi.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    ScraperService,
    LinkResolverService,
    ScraperapiProvider,
    RetailedProvider,
    SearchapiProvider,
  ],
  exports: [ScraperService, LinkResolverService],
})
export class ScraperModule {}
