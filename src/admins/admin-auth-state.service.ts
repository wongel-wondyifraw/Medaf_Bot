import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 5 * 60 * 1000;

export type PendingAction =
  | 'admin-grant'
  | 'admin-revoke'
  | 'edit-margin'
  | 'edit-delivery'
  | 'edit-rate'
  | 'add-admin';

interface PendingState {
  action: PendingAction;
  since: number;
}

@Injectable()
export class AdminAuthStateService {
  private readonly state = new Map<number, PendingState>();

  setPending(userId: number, action: PendingAction): void {
    this.state.set(userId, { action, since: Date.now() });
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

  clearPending(userId: number): void {
    this.state.delete(userId);
  }
}
