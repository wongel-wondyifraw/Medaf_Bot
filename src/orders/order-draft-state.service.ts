import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 30 * 60 * 1000;

export type DraftStep =
  | 'size'
  | 'color'
  | 'qty'
  | 'qty-input'
  | 'price'
  | 'confirm';

export interface OrderDraft {
  productId: string | null;
  link: string;
  productTitle: string;
  sizes: string[];
  colors: string[];
  selectedSize: string | null;
  selectedColor: string | null;
  quantity: number;
  /** USD as derived from the scrape. Null when the scraper had no USD figure. */
  scrapedUnitUsd: number | null;
  /** USD as entered by the user. Null until the user has chosen on the price step. */
  userUnitUsd: number | null;
  /** Per-unit ETB selling price (excludes delivery). */
  unitEtb: number;
  /** Selling ETB (unit × qty), excludes delivery. */
  sellingEtb: number;
  /** Final order total ETB (unit × qty + delivery). */
  totalEtb: number;
  /** Snapshot of the delivery fee used for this draft. */
  deliveryEtb: number;
  /** Snapshot of the profit margin (%) used for this draft. */
  marginPercent: number;
  /** Snapshot of the USD→ETB rate used for this draft. */
  rateUsed: number;
  /** Resolved category name (or null when no category matched). */
  categoryName: string | null;
  step: DraftStep;
  since: number;
}

export interface CreateDraftInput {
  productId: string | null;
  link: string;
  productTitle: string;
  sizes: string[];
  colors: string[];
  scrapedUnitUsd: number | null;
  unitEtb: number;
  sellingEtb: number;
  totalEtb: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  categoryName: string | null;
}

export interface UpdatePriceInput {
  userUnitUsd: number;
  unitEtb: number;
  sellingEtb: number;
  totalEtb: number;
  /**
   * The margin (%) actually applied to compute the ETB amounts above. The
   * draft's marginPercent snapshot is rewritten so downstream code keeps
   * matching the user-facing math.
   */
  marginPercent: number;
  /**
   * The USD→ETB rate actually used at price-entry time. We refresh this from
   * the `settings.usd_to_etb` row, so the snapshot may legitimately differ
   * from the value captured at draft creation if the admin edited it in
   * between.
   */
  rateUsed: number;
}

@Injectable()
export class OrderDraftStateService {
  private readonly drafts = new Map<number, OrderDraft>();

  setDraft(userId: number, input: CreateDraftInput): OrderDraft {
    const step: DraftStep =
      input.sizes.length > 0 ? 'size' : input.colors.length > 0 ? 'color' : 'qty';
    const draft: OrderDraft = {
      productId: input.productId,
      link: input.link,
      productTitle: input.productTitle,
      sizes: input.sizes,
      colors: input.colors,
      selectedSize: null,
      selectedColor: null,
      quantity: 1,
      scrapedUnitUsd: input.scrapedUnitUsd,
      userUnitUsd: null,
      unitEtb: input.unitEtb,
      sellingEtb: input.sellingEtb,
      totalEtb: input.totalEtb,
      deliveryEtb: input.deliveryEtb,
      marginPercent: input.marginPercent,
      rateUsed: input.rateUsed,
      categoryName: input.categoryName,
      step,
      since: Date.now(),
    };
    this.drafts.set(userId, draft);
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

  selectSize(userId: number, size: string): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.selectedSize = size;
    draft.step = draft.colors.length > 0 ? 'color' : 'qty';
    draft.since = Date.now();
    return draft;
  }

  selectColor(userId: number, color: string): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.selectedColor = color;
    draft.step = 'qty';
    draft.since = Date.now();
    return draft;
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
    draft.userUnitUsd = input.userUnitUsd;
    draft.unitEtb = input.unitEtb;
    draft.sellingEtb = input.sellingEtb;
    draft.totalEtb = input.totalEtb;
    draft.marginPercent = input.marginPercent;
    draft.rateUsed = input.rateUsed;
    draft.step = 'confirm';
    draft.since = Date.now();
    return draft;
  }
}
