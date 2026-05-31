import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScraperService } from './scraper.service';
import { LinkResolverService } from './link-resolver.service';
import { SharePreviewService } from './share-preview.service';
import { ScraperapiProvider } from './providers/scraperapi.provider';
import { RetailedProvider } from './providers/retailed.provider';
import { SearchapiProvider } from './providers/searchapi.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    ScraperService,
    LinkResolverService,
    SharePreviewService,
    ScraperapiProvider,
    RetailedProvider,
    SearchapiProvider,
  ],
  exports: [ScraperService, LinkResolverService, SharePreviewService],
})
export class ScraperModule {}
