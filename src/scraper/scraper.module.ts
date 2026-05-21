import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScraperService } from './scraper.service';
import { ScraperapiProvider } from './providers/scraperapi.provider';
import { RetailedProvider } from './providers/retailed.provider';
import { SearchapiProvider } from './providers/searchapi.provider';

@Module({
  imports: [ConfigModule],
  providers: [ScraperService, ScraperapiProvider, RetailedProvider, SearchapiProvider],
  exports: [ScraperService],
})
export class ScraperModule {}
