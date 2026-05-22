import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  findAll(): Promise<Category[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  findById(id: number): Promise<Category | null> {
    return this.repo.findOne({ where: { id } });
  }

  async setShippingCost(id: number, cost: number | null): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.shippingCost = cost;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) shippingcost set to ${cost}`);
    return existing;
  }
}
