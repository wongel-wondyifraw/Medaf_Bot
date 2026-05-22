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

  findByName(name: string): Promise<Category | null> {
    return this.repo.findOne({ where: { name } });
  }

  async create(
    name: string,
    shippingCost: number | null = null,
  ): Promise<{ category?: Category; error?: 'duplicate' | 'invalid' }> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return { error: 'invalid' };
    const existing = await this.findByName(trimmed);
    if (existing) return { error: 'duplicate' };
    const saved = await this.repo.save({ name: trimmed, shippingCost });
    this.logger.log(
      `Category created: ${saved.name} (#${saved.id}) shipping_cost=${shippingCost ?? 'null'}`,
    );
    return { category: saved };
  }

  async setShippingCost(id: number, cost: number | null): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.shippingCost = cost;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) shipping_cost set to ${cost}`);
    return existing;
  }
}
