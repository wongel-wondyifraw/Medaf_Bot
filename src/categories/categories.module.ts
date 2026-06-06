import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoryAiService } from './category-ai.service';
import { CategoryGroqService } from './category-groq.service';
import { CategoryEditStateService } from './category-edit-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([Category]), ConfigModule],
  providers: [
    CategoriesService,
    CategoryGroqService,
    CategoryAiService,
    CategoryEditStateService,
  ],
  exports: [CategoriesService, CategoryEditStateService],
})
export class CategoriesModule {}
