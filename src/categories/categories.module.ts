import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoryEditStateService } from './category-edit-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  providers: [CategoriesService, CategoryEditStateService],
  exports: [CategoriesService, CategoryEditStateService],
})
export class CategoriesModule {}
