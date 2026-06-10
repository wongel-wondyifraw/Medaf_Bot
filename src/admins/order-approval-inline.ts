import { Markup } from 'telegraf';

/** Inline actions for a single order in admin feed / notification messages. */
export function orderApprovalInlineKeyboard(
  orderId: number,
  opts?: { labelSuffix?: string },
) {
  const suffix = opts?.labelSuffix ?? '';
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`✓ Approve${suffix}`, `admin:approve:${orderId}`),
      Markup.button.callback(`✏️ Adjust price${suffix}`, `admin:adjust:${orderId}`),
      Markup.button.callback(`✗ Reject${suffix}`, `admin:reject:${orderId}`),
    ],
  ]);
}
