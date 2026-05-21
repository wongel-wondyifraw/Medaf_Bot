import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

export interface CreateOrderInput {
  resellerId: number;
  productId: string | null;
  productTitle: string;
  sellingEtb: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly repo: Repository<Order>,
  ) {}

  create(input: CreateOrderInput): Promise<Order> {
    const order = this.repo.create({ ...input, status: 'pending' });
    return this.repo.save(order);
  }

  findById(id: number): Promise<Order | null> {
    return this.repo.findOne({ where: { id } });
  }

  async cancel(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order) return null;
    if (order.status === 'cancelled') return order;
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    return this.repo.save(order);
  }
}
