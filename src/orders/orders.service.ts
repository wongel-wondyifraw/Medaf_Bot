import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from './order.entity';

export interface CreateOrderInput {
  resellerId: number;
  productId: string | null;
  productTitle: string;
  link: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  unitEtb: number | null;
  scrapedUnitUsd: number | null;
  userUnitUsd: number | null;
  sellingEtb: number;
}

export interface OrdersReport {
  awaitingApproval: number;
  awaitingPayment: number;
  pending: number;
  cancelled: number;
  completed: number;
  totalRevenueEtb: number;
  last24hCount: number;
  recent: Order[];
}

export function computeDownPaymentEtb(sellingEtb: number): number {
  return Math.ceil(sellingEtb / 2);
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly repo: Repository<Order>,
  ) {}

  create(input: CreateOrderInput): Promise<Order> {
    const order = this.repo.create({
      ...input,
      status: 'awaiting_approval',
      originalSellingEtb: input.sellingEtb,
    });
    return this.repo.save(order);
  }

  findById(id: number): Promise<Order | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByIdWithReseller(id: number): Promise<Order | null> {
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where('o.id = :id', { id })
      .getOne();
  }

  async cancel(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order) return null;
    if (order.status === 'cancelled') return order;
    if (order.status === 'completed') return null;
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    return this.repo.save(order);
  }

  async approve(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order || order.status !== 'awaiting_approval') return null;
    order.downPaymentEtb = computeDownPaymentEtb(order.sellingEtb);
    order.adminApprovedAt = new Date();
    order.status = 'awaiting_payment';
    return this.repo.save(order);
  }

  async overridePrice(id: number, newSellingEtb: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order || order.status !== 'awaiting_approval') return null;
    if (!Number.isFinite(newSellingEtb) || newSellingEtb <= 0) return null;
    order.sellingEtb = Math.round(newSellingEtb);
    order.downPaymentEtb = computeDownPaymentEtb(order.sellingEtb);
    order.adminApprovedAt = new Date();
    order.status = 'awaiting_payment';
    return this.repo.save(order);
  }

  async reject(id: number, reason: string): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order || order.status !== 'awaiting_approval') return null;
    order.status = 'cancelled';
    order.rejectionReason = reason.trim().slice(0, 500);
    order.cancelledAt = new Date();
    return this.repo.save(order);
  }

  async confirmPayment(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order || order.status !== 'awaiting_payment') return null;
    order.status = 'pending';
    order.paymentConfirmedAt = new Date();
    return this.repo.save(order);
  }

  async markCompleted(id: number): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order) return null;
    if (order.status === 'completed') return order;
    if (order.status === 'cancelled') return null;
    if (order.status !== 'pending') return null;
    order.status = 'completed';
    return this.repo.save(order);
  }

  findByResellerId(resellerId: number, limit = 25): Promise<Order[]> {
    return this.repo.find({
      where: { resellerId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findAwaitingApproval(): Promise<Order[]> {
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where("o.status = 'awaiting_approval'")
      .orderBy('o.created_at', 'ASC')
      .getMany();
  }

  findPending(): Promise<Order[]> {
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where("o.status = 'pending'")
      .orderBy('o.created_at', 'ASC')
      .getMany();
  }

  findCreatedSince(
    since: Date,
    status?: OrderStatus,
  ): Promise<Order[]> {
    const qb = this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where('o.created_at > :since', { since });
    if (status) {
      qb.andWhere('o.status = :status', { status });
    }
    return qb.orderBy('o.created_at', 'ASC').getMany();
  }

  findCreatedSinceWithStatuses(since: Date, statuses: OrderStatus[]): Promise<Order[]> {
    if (statuses.length === 0) return Promise.resolve([]);
    const qb = this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reseller', 'reseller')
      .where('o.created_at > :since', { since })
      .andWhere('o.status IN (:...statuses)', { statuses });
    return qb.orderBy('o.created_at', 'ASC').getMany();
  }

  async getReport(): Promise<OrdersReport> {
    const [awaitingApproval, awaitingPayment, pending, cancelled, completed] =
      await Promise.all([
        this.repo.count({ where: { status: 'awaiting_approval' } }),
        this.repo.count({ where: { status: 'awaiting_payment' } }),
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

    return {
      awaitingApproval,
      awaitingPayment,
      pending,
      cancelled,
      completed,
      totalRevenueEtb,
      last24hCount,
      recent,
    };
  }
}
