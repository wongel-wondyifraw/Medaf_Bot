import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 30 * 60 * 1000;

export type DraftStep =
  | 'preferences'
  | 'qty'
  | 'qty-input'
  | 'price'
  | 'confirm';

export interface OrderDraft {
  productId: string | null;
  link: string;
  productTitle: string;
  /** Free-text size, color, and other variant preferences from the user. */
  preferencesText: string | null;
  selectedSize: string | null;
  selectedColor: string | null;
  quantity: number;
  /** AED as entered by the user from SHEIN UAE location. */
  userUnitAed: number | null;
  /** Per-unit ETB selling price (excludes delivery). */
  unitEtb: number;
  /** Final order total ETB (unit × qty + delivery). */
  totalEtb: number;
  /** Snapshot of the delivery fee used for this draft. */
  deliveryEtb: number;
  /** Resolved category name (or null when no category matched). */
  categoryName: string | null;
  /** Profit portion per unit in ETB. */
  profitEtb: number | null;
  step: DraftStep;
  since: number;
}

export interface CreateDraftInput {
  productId: string | null;
  link: string;
  productTitle: string;
  totalEtb: number;
  deliveryEtb: number;
  categoryName: string | null;
}

export interface UpdatePriceInput {
  userUnitAed: number;
  unitEtb: number;
  totalEtb: number;
  profitEtb: number;
}

@Injectable()
export class OrderDraftStateService {
  private readonly drafts = new Map<number, OrderDraft>();

  setDraft(userId: number, input: CreateDraftInput): OrderDraft {
    const draft: OrderDraft = {
      productId: input.productId,
      link: input.link,
      productTitle: input.productTitle,
      preferencesText: null,
      selectedSize: null,
      selectedColor: null,
      quantity: 1,
      userUnitAed: null,
      unitEtb: 0,
      totalEtb: input.totalEtb,
      deliveryEtb: input.deliveryEtb,
      categoryName: input.categoryName,
      profitEtb: null,
      step: 'preferences',
      since: Date.now(),
    };
    this.drafts.set(userId, draft);
    return draft;
  }

  setPreferences(userId: number, preferencesText: string): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft || draft.step !== 'preferences') return null;
    draft.preferencesText = preferencesText;
    draft.selectedSize = preferencesText;
    draft.selectedColor = null;
    draft.step = 'qty';
    draft.since = Date.now();
    return draft;
  }

  getDraft(userId: number): OrderDraft | null {
    const entry = this.drafts.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.drafts.delete(userId);
      return null;
    }
    return entry;
  }

  clearDraft(userId: number): void {
    this.drafts.delete(userId);
  }

  selectQuantity(userId: number, quantity: number): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.quantity = quantity;
    // Don't multiply totals here — totals are recomputed by the calculator
    // when the user supplies (or accepts) the unit price in the next step.
    draft.step = 'price';
    draft.since = Date.now();
    return draft;
  }

  /**
   * Transitions the draft into the "custom quantity" sub-step where the
   * keyboard is removed and the user is expected to type a number. Only valid
   * from the regular `qty` step so a tap on "➕ More" can't reopen the
   * keyboardless step from later in the flow.
   */
  enterQuantityInputMode(userId: number): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    if (draft.step !== 'qty') return null;
    draft.step = 'qty-input';
    draft.since = Date.now();
    return draft;
  }

  /**
   * Inverse of `enterQuantityInputMode` — returns the draft from the custom
   * quantity input back to the regular quantity keyboard. No-op when the
   * draft isn't currently in `qty-input`.
   */
  exitQuantityInputMode(userId: number): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    if (draft.step !== 'qty-input') return null;
    draft.step = 'qty';
    draft.since = Date.now();
    return draft;
  }

  setUserPrice(userId: number, input: UpdatePriceInput): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.userUnitAed = input.userUnitAed;
    draft.unitEtb = input.unitEtb;
    draft.totalEtb = input.totalEtb;
    draft.profitEtb = input.profitEtb;
    draft.step = 'confirm';
    draft.since = Date.now();
    return draft;
  }
}
