import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 5 * 60 * 1000;

export type PendingAction =
  | 'admin-grant'
  | 'edit-delivery'
  | 'edit-rate'
  | 'add-admin'
  | 'edit-category-fee'
  | 'edit-category-commission'
  | 'add-category'
  | 'add-category-fee'
  | 'add-category-commission'
  | 'edit-rate-aed'
  | 'edit-rate-aed-etb'
  | 'edit-bank-account'
  | 'adjust-price'
  | 'reject-reason';

interface PendingState {
  action: PendingAction;
  since: number;
  orderId?: number;
}

@Injectable()
export class AdminAuthStateService {
  private readonly state = new Map<number, PendingState>();

  setPending(userId: number, action: PendingAction): void {
    this.state.set(userId, { action, since: Date.now() });
  }

  setPendingForOrder(userId: number, action: PendingAction, orderId: number): void {
    this.state.set(userId, { action, since: Date.now(), orderId });
  }

  getPending(userId: number): PendingAction | null {
    const entry = this.state.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.state.delete(userId);
      return null;
    }
    return entry.action;
  }

  getPendingOrderId(userId: number): number | null {
    const entry = this.state.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.state.delete(userId);
      return null;
    }
    return entry.orderId ?? null;
  }

  clearPending(userId: number): void {
    this.state.delete(userId);
  }
}
