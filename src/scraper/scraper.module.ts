import { Module } from '@nestjs/common';
import { LinkResolverService } from './link-resolver.service';
import { SharePreviewService } from './share-preview.service';

@Module({
  providers: [LinkResolverService, SharePreviewService],
  exports: [LinkResolverService, SharePreviewService],
})
export class ScraperModule {}
