import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

export interface CreateOrderInput {
  resellerId: number;
  productId: string | null;
  productTitle: string;
  link: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  unitEtb: number | null;
  sellingEtb: number;
}

export interface OrdersReport {
  pending: number;
  cancelled: number;
  completed: number;
  totalRevenueEtb: number;
  last24hCount: number;
  recent: Order[];
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

  async markCompleted(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order) return null;
    if (order.status === 'completed') return order;
    if (order.status === 'cancelled') return null;
    order.status = 'completed';
    return this.repo.save(order);
  }

  findPending(): Promise<Order[]> {
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where("o.status = 'pending'")
      .orderBy('o.created_at', 'ASC')
      .getMany();
  }

  findCreatedSince(since: Date): Promise<Order[]> {
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where('o.created_at > :since', { since })
      .orderBy('o.created_at', 'ASC')
      .getMany();
  }

  async getReport(): Promise<OrdersReport> {
    const [pending, cancelled, completed] = await Promise.all([
      this.repo.count({ where: { status: 'pending' } }),
      this.repo.count({ where: { status: 'cancelled' } }),
      this.repo.count({ where: { status: 'completed' } }),
    ]);

    const revenueRow = await this.repo
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.selling_etb), 0)', 'total')
      .where("o.status <> 'cancelled'")
      .getRawOne<{ total: string }>();
    const totalRevenueEtb = parseInt(revenueRow?.total || '0', 10) || 0;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hCount = await this.repo
      .createQueryBuilder('o')
      .where('o.created_at >= :since', { since })
      .getCount();

    const recent = await this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .orderBy('o.created_at', 'DESC')
      .limit(10)
      .getMany();

    return { pending, cancelled, completed, totalRevenueEtb, last24hCount, recent };
  }
}
