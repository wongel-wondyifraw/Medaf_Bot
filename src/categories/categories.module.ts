import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoryAiService } from './category-ai.service';
import { CategoryEditStateService } from './category-edit-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  providers: [CategoriesService, CategoryAiService, CategoryEditStateService],
  exports: [CategoriesService, CategoryEditStateService],
})
export class CategoriesModule {}
