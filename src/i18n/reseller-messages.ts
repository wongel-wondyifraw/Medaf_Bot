import { bilingual, bilingualHtml } from './bilingual';
import type { OrderStatus } from '../orders/order.entity';

/** Bilingual "Label: value" line for draft/order summaries. */
export function bilingualLabel(enLabel: string, amLabel: string, value: string): string {
  return `${enLabel}: <b>${value}</b>\n${amLabel}: <b>${value}</b>`;
}

/** Sticky keyboard and inline button labels (must match onText handlers). */
export const resellerButtons = {
  myOrders: '📋 My orders · ትዕዛዞቼ',
  update: '🔄 Update · አዘምን',
  sharePhone: '📱 Share my phone · ስልክ ያጋሩ',
  cancel: '✗ Cancel · ሰርዝ',
  cancelRequest: '❌ Cancel request · ጥያቄ ሰርዝ',
  back: '← Back · ተመለስ',
  more: '➕ More · ተጨማሪ',
  placeOrder: '✓ Place order · ያስቀምጡ',
  paid: '✅ Paid · ተከፍሏል',
  viewProduct: '🔗 View product · ምርት ይመልከቱ',
} as const;

export const resellerMessages = {
  registration: {
    welcomeAskName: () =>
      bilingual(
        'Welcome to Medaf SHEIN orders.\n\nBefore placing your first order, please complete a quick registration.\n\nWhat is your full name?',
        'ወደ Medaf SHEIN ትዕዛዞች እንኳን በደህና መጡ።\n\nመጀመሪያ ትዕዛዝ ከመስጠትዎ በፊት አጭር ምዝገባ ያጠናቅቁ።\n\nሙሉ ስምዎ ምንድን ነው?',
      ),
    askPhone: () =>
      bilingual(
        'Thank you. Please share your phone number using the button below to finish registration.',
        'አመሰግናለሁ። ምዝገባውን ለማጠናቀቅ ከታች ያለውን ቁልፍ በመጠቀም ስልክ ቁጥርዎን ያጋሩ።',
      ),
    wrongContact: () =>
      bilingual(
        'Please share your own phone number, not someone else\u2019s.',
        'እባክዎ የራስዎን ስልክ ቁጥር ያጋሩ፣ የሌላ ሰውን አይደለም።',
      ),
    nameInvalid: () =>
      bilingual(
        'Please enter your full name (2-80 characters).',
        'እባክዎ ሙሉ ስምዎን ያስገቡ (2-80 ቁምፊ)።',
      ),
    complete: () =>
      bilingual(
        'Registration complete. Welcome to Medaf SHEIN orders — send a SHEIN product link to place your order.',
        'ምዝገባ ተጠናቋል። ወደ Medaf SHEIN ትዕዛዞች እንኳን በደህና መጡ — ትዕዛዝ ለመስጠት የSHEIN ምርት ሊንክ ይላኩ።',
      ),
    welcomeRegistered: () =>
      bilingual(
        'Welcome to Medaf SHEIN orders.\nSend a SHEIN product link to place your order.',
        'ወደ Medaf SHEIN ትዕዛዞች እንኳን በደህና መጡ።\nትዕዛዝ ለመስጠት የSHEIN ምርት ሊንክ ይላኩ።',
      ),
    updated: () =>
      bilingualHtml(
        '✅ <b>Medaf Bot updated!</b> You\u2019re on the latest version.\n\nSend a SHEIN product link to place your order.',
        '✅ <b>Medaf ቦት ተዘምኗል!</b> በቅርብ ስሪት ላይ ነዎት።\n\nትዕዛዝ ለመስጠት የSHEIN ምርት ሊንክ ይላኩ።',
      ),
    myOrdersRequiresRegistration: () =>
      bilingual(
        'Please complete registration with /start before viewing orders.',
        'ትዕዛዞችን ከመመልከትዎ በፊት እባክዎ በ /start ምዝገባውን ያጠናቅቁ።',
      ),
  },

  links: {
    notShein: () =>
      bilingual(
        'Please send a valid SHEIN product link.',
        'እባክዎ ትክክለኛ የSHEIN ምርት ሊንክ ይላኩ።',
      ),
    noUrl: () =>
      bilingual(
        'No URL found in your message.',
        'በመልዕክትዎ ውስጥ ሊንክ አልተገኘም።',
      ),
    invalidUrl: () =>
      bilingual(
        'That does not look like a valid URL.',
        'ይህ ትክክለኛ ሊንክ አይመስልም።',
      ),
    notSheinHost: () =>
      bilingual(
        'That URL does not look like a SHEIN link.',
        'ይህ ሊንክ የSHEIN ሊንክ አይመስልም።',
      ),
    notProductPage: () =>
      bilingual(
        'That SHEIN link is not a product page. Send the URL of a product detail page (ends with "-p-<number>.html").',
        'ይህ የSHEIN ሊንክ የምርት ገጽ አይደለም። የምርት ዝርዝር ገጽ ሊንክ ይላኩ (በ "-p-<ቁጥር>.html" የሚያበቃ)።',
      ),
    preparing: () =>
      bilingual(
        'Preparing product details, please wait...',
        'የምርት ዝርዝር በማዘጋጀት ላይ፣ እባክዎ ይጠብቁ...',
      ),
  },

  orderDraft: {
    categoryLabel: 'Category',
    categoryLabelAm: 'ምድብ',
    preferencesLabel: 'Preferences',
    preferencesLabelAm: 'ምርጫዎች',
    quantityLabel: 'Quantity',
    quantityLabelAm: 'ብዛት',
    quantityPending: 'pending',
    quantityPendingAm: 'በመጠባበቅ ላይ',
    estimatedCost: (etb: string) =>
      bilingualHtml(
        `<b>Estimated Cost: ${etb} ETB</b>`,
        `<b>ግምታዊ ዋጋ፡ ${etb} ብር</b>`,
      ),
    hintPreferences: () =>
      bilingual(
        'Reply with your preferences (size, color, etc.) — e.g. Size M, Black.',
        'ምርጫዎችዎን ይፃፉ (መጠን፣ ቀለም ወዘተ) — ለምሳሌ፡ Size M, Black።',
      ),
    hintQty: () =>
      bilingual(
        'Choose a quantity, or tap "➕ More" to enter your own.',
        'ብዛት ይምረጡ፣ ወይም የራስዎን ለመግባት "➕ More" ይጫኑ።',
      ),
    hintQtyInput: () =>
      bilingual(
        'Reply with a quantity (1–100), or tap "← Back" / "✗ Cancel".',
        'ብዛት ይፃፉ (1–100)፣ ወይም "← Back" / "✗ Cancel" ይጫኑ።',
      ),
    hintConfirm: () =>
      bilingual(
        'Review the summary, then confirm or cancel.',
        'ማጠቃለያውን ይመልከቱ፣ ከዚያ ያረጋግጡ ወይም ይሰርዙ።',
      ),
    priceInstructions: (compact?: boolean) => {
      if (compact) {
        return [
          '1) SHEIN Location → UAE',
          '2) Send AED (Dirham) price',
          '3) Tap Place order',
          '',
          '1) Location → UAE',
          '2) AED (ድርሃም) ዋጋ ይላኩ',
          '3) Order ይጫኑ',
        ].join('\n');
      }
      return [
        '1. Set your SHEIN app Location to United Arab Emirates (UAE).',
        '2. Send the AED (Dirham) price you see on the app.',
        '3. After you review the price, tap the Place order button.',
        '',
        '1. በSHEIN አፕሊኬሽን Location ወደ United Arab Emirates (UAE) ይቀይሩ።',
        '2. በአፑ ላይ የሚያዩትን AED (ድርሃም) ዋጋ ይላኩ ።',
        '3. ዋጋውን ከተመለከቱ በኋላ (Order) ሚለውን ቁልፍ ይጫኑ።',
      ].join('\n');
    },
    preferencesInvalid: () =>
      bilingualHtml(
        'Please enter your preferences in one message (1–200 characters), e.g. <code>Size M, Black</code>.',
        'እባክዎ ምርጫዎችዎን በአንድ መልዕክት ይፃፉ (1–200 ቁምፊ)፣ ለምሳሌ፡ <code>Size M, Black</code>።',
      ),
    quantityNotWhole: () =>
      bilingualHtml(
        'That does not look like a whole number. Send a quantity like <code>7</code> (between 1 and 100), or tap "← Back" / "✗ Cancel".',
        'ይህ ሙሉ ቁጥር አይመስልም። እንደ <code>7</code> ብዛት ይላኩ (1 እስከ 100)፣ ወይም "← Back" / "✗ Cancel" ይጫኑ።',
      ),
    quantityOutOfRange: () =>
      bilingual(
        'Quantity must be a whole number between 1 and 100.',
        'ብዛት በ1 እና 100 መካከል ሙሉ ቁጥር መሆን አለበት።',
      ),
    priceInvalid: () =>
      bilingualHtml(
        'That does not look like a price. Send a number like <code>35</code> or <code>35.50</code>, or send <code>cancel</code>.',
        'ይህ ዋጋ አይመስልም። እንደ <code>35</code> ወይም <code>35.50</code> ቁጥር ይላኩ፣ ወይም <code>cancel</code> ይላኩ።',
      ),
    priceOutOfRange: () =>
      bilingual(
        'Price must be between 0.01 and 1,000,000 AED.',
        'ዋጋ በ0.01 እና 1,000,000 AED መካከል መሆን አለበት።',
      ),
    priceRateNotConfigured: () =>
      bilingual(
        'Could not price this order — AED→ETB rate is not configured. An admin needs to set it under Settings → AED→ETB.',
        'ትዕዛዙን ማስቀመጥ አልተቻለም — AED→ETB ተመን አልተዋቀረም። አስተዳዳሪ በ Settings → AED→ETB ላይ ማስቀመጥ አለበት።',
      ),
    sessionExpired: () =>
      bilingual(
        'Order session expired. Send the link again.',
        'የትዕዛዝ ክፍለ ጊዜ አልቋል። ሊንኩን እንደገና ይላኩ።',
      ),
    cancelled: () =>
      bilingual('Order cancelled.', 'ትዕዛዝ ተሰርዟል።'),
    submitted: () =>
      bilingual(
        '⏳ Submitted — awaiting admin approval',
        '⏳ ቀርቧል — የአስተዳዳሪ ፈቃድ በመጠባበቅ ላይ',
      ),
  },

  orderActions: {
    invalidQuantity: () =>
      bilingual('Invalid quantity.', 'ልክ ያልሆነ ብዛት።'),
    quantityToast: (qty: number) =>
      bilingual(`Quantity: ${qty}`, `ብዛት፡ ${qty}`),
    notOnQuantityStep: () =>
      bilingual('Not on the quantity step.', 'በብዛት ደረጃ ላይ አይደሉም።'),
    couldNotOpenQtyInput: () =>
      bilingual(
        'Could not open custom quantity input.',
        'ብጁ ብዛት ማስገቢያ ሊከፈት አልቻለም።',
      ),
    notOnCustomQuantityStep: () =>
      bilingual(
        'Not on the custom quantity step.',
        'በብጁ ብዛት ደረጃ ላይ አይደሉም።',
      ),
    notOnPriceStep: () =>
      bilingual('Not on the price step.', 'በዋጋ ደረጃ ላይ አይደሉም።'),
    registerFirst: () =>
      bilingual(
        'Please /start the bot to register first.',
        'እባክዎ መጀመሪያ ለመመዝገብ /start ይላኩ።',
      ),
    finishRegistration: () =>
      bilingual(
        'Please finish registration before placing an order.',
        'ትዕዛዝ ከመስጠትዎ በፊት እባክዎ ምዝገባውን ያጠናቅቁ።',
      ),
    completePriceFirst: () =>
      bilingual(
        'Please complete the unit price step before confirming.',
        'ከማረጋገጥዎ በፊት እባክዎ የዋጋ ደረጃውን ያጠናቅቁ።',
      ),
    requestSubmitted: () =>
      bilingual(
        'Request submitted! We will review it shortly.',
        'ጥያቄ ቀርቧል! በቅርቡ እንመለከተዋለን።',
      ),
    couldNotSave: () =>
      bilingual(
        'Could not save your order. Please try again.',
        'ትዕዛዝዎን ማስቀመጥ አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
      ),
    invalidOrder: () => bilingual('Invalid order.', 'ልክ ያልሆነ ትዕዛዝ።'),
    orderNotFound: () => bilingual('Order not found.', 'ትዕዛዝ አልተገኘም።'),
    cancelOwnOnly: () =>
      bilingual(
        'You can only cancel your own orders.',
        'የራስዎን ትዕዛዞች ብቻ ማስረዝ ይችላሉ።',
      ),
    alreadyCancelled: () =>
      bilingual('Order was already cancelled.', 'ትዕዛዝ አስቀድሞ ተሰርዟል።'),
    alreadyCompleted: () =>
      bilingual(
        'This order was already completed.',
        'ይህ ትዕዛዝ አስቀድሞ ተጠናቋል።',
      ),
    cannotCancelConfirmed: () =>
      bilingual(
        'This order is already confirmed and cannot be cancelled here.',
        'ይህ ትዕዛዝ አስቀድሞ ተረጋግጧል እና እዚህ ሊሰረዝ አይችልም።',
      ),
    cannotCancel: () =>
      bilingual('This order cannot be cancelled.', 'ይህ ትዕዛዝ ሊሰረዝ አይችልም።'),
    orderCancelled: () => bilingual('Order cancelled.', 'ትዕዛዝ ተሰርዟል።'),
    couldNotCancel: () =>
      bilingual(
        'Could not cancel your order. Please try again.',
        'ትዕዛዝዎን ማስረዝ አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
      ),
    confirmOwnOnly: () =>
      bilingual(
        'You can only confirm your own orders.',
        'የራስዎን ትዕዛዞች ብቻ ማረጋገጥ ይችላሉ።',
      ),
    paymentAlreadyConfirmed: () =>
      bilingual('Payment was already confirmed.', 'ክፍያ አስቀድሞ ተረጋግጧል።'),
    orderWasCancelled: () =>
      bilingual('This order was cancelled.', 'ይህ ትዕዛዝ ተሰርዟል።'),
    notAwaitingPayment: () =>
      bilingual(
        'This order is not awaiting payment.',
        'ይህ ትዕዛዝ ክፍያ በመጠባበቅ ላይ አይደለም።',
      ),
    couldNotConfirmPayment: () =>
      bilingual(
        'Could not confirm payment. Please try again.',
        'ክፍያ ማረጋገጥ አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
      ),
    orderPlaced: () => bilingual('Order placed!', 'ትዕዛዝ ተቀምጧል!'),
    statusCancelled: () => bilingual('✗ Order cancelled', '✗ ትዕዛዝ ተሰርዟል'),
    statusPaymentConfirmed: () =>
      bilingual(
        '✓ Payment confirmed — order placed',
        '✓ ክፍያ ተረጋግጧል — ትዕዛዝ ተቀምጧል',
      ),
  },

  postOrder: {
    paymentRequest: (
      orderId: number,
      totalEtb: string,
      downPaymentEtb: string,
      bankAccountHtml: string,
    ) =>
      bilingualHtml(
        [
          `<b>Order #${orderId} approved by Medaf collation</b>`,
          '',
          `Total: <b>${totalEtb} ETB</b>`,
          `Down payment (50%): <b>${downPaymentEtb} ETB</b>`,
          `Transfer to: <b>${bankAccountHtml}</b>`,
          '',
          'Tap below after you have paid.',
        ].join('\n'),
        [
          `<b>ትዕዛዝ #${orderId} በMedaf collation ጸድቋል</b>`,
          '',
          `ጠቅላላ፡ <b>${totalEtb} ብር</b>`,
          `ቅድመ ክፍያ (50%)፡ <b>${downPaymentEtb} ብር</b>`,
          `ወደ፡ <b>${bankAccountHtml}</b> ያስተላልፉ`,
          '',
          'ከከፈሉ በኋላ ከታች ይጫኑ።',
        ].join('\n'),
      ),
    paymentConfirmed: (orderId: number, totalEtb: string, downPaymentEtb: string) =>
      bilingualHtml(
        [
          `<b>Order #${orderId}</b>`,
          '',
          `Total: <b>${totalEtb} ETB</b>`,
          `Down payment received: <b>${downPaymentEtb} ETB</b>`,
        ].join('\n'),
        [
          `<b>ትዕዛዝ #${orderId}</b>`,
          '',
          `ጠቅላላ፡ <b>${totalEtb} ብር</b>`,
          `ቅድመ ክፍያ ተቀብሏል፡ <b>${downPaymentEtb} ብር</b>`,
        ].join('\n'),
      ),
    paymentConfirmedFooter: () =>
      bilingual(
        '✓ Order placed — Medaf collation will process your order',
        '✓ ትዕዛዝ ተቀምጧል — Medaf collation ትዕዛዝዎን ያቀናብራል',
      ),
    discount: (discountPct: number, orderId: number) =>
      bilingualHtml(
        [
          '<b>Good news!</b>',
          '',
          `Medaf collation issued a <b>${discountPct}%</b> discount on your order.`,
          '',
          `Order <b>#${orderId}</b>`,
        ].join('\n'),
        [
          '<b>ደስተኛ ዜና!</b>',
          '',
          `Medaf collation በትዕዛዝዎ ላይ <b>${discountPct}%</b> ቅናሽ ሰጥቷል።`,
          '',
          `ትዕዛዝ <b>#${orderId}</b>`,
        ].join('\n'),
      ),
    priceCorrection: (correctionPct: number, orderId: number) =>
      bilingualHtml(
        [
          '<b>A quick note from Medaf collation</b>',
          '',
          `After reviewing your order, we applied a <b>${correctionPct}%</b> price correction to reflect the actual cost.`,
          'Thank you for your understanding.',
          '',
          `Order <b>#${orderId}</b>`,
        ].join('\n'),
        [
          '<b>ከMedaf collation አጭር ማስታወሻ</b>',
          '',
          `ትዕዛዝዎን ከተመለከትን በኋላ እውነተኛ ወጪን ለማንፀባረቅ <b>${correctionPct}%</b> የዋጋ ማስተካከል ተተገብሯል።`,
          'ለመረዳትዎ እናመሰግናለን።',
          '',
          `ትዕዛዝ <b>#${orderId}</b>`,
        ].join('\n'),
      ),
    storeCancellation: (
      nameHtml: string,
      orderId: number,
      titleHtml: string,
      detailHtml: string | null,
    ) => {
      const enDetail = detailHtml ?? 'We\u2019re sorry \u2014 this order will not be processed.';
      const amDetail =
        detailHtml ??
        'እናዝናለን — ይህ ትዕዛዝ አይቀጥልም።';
      return bilingualHtml(
        [
          `Hi <b>${nameHtml}</b>,`,
          '',
          `<b>Medaf store</b> has cancelled your order <b>#${orderId}</b>:`,
          `<i>${titleHtml}</i>`,
          '',
          enDetail,
          '',
          'If you have questions, please contact <b>Medaf store</b>.',
        ].join('\n'),
        [
          `ሰላም <b>${nameHtml}</b>,`,
          '',
          `<b>Medaf store</b> ትዕዛዝዎን <b>#${orderId}</b> ሰርዟል፡`,
          `<i>${titleHtml}</i>`,
          '',
          amDetail,
          '',
          'ጥያቄ ካለዎት እባክዎ <b>Medaf store</b>ን ያግኙ።',
        ].join('\n'),
      );
    },
  },

  myOrders: {
    header: () =>
      bilingualHtml('<b>📋 My orders</b>', '<b>📋 ትዕዛዞቼ</b>'),
    pageInfo: (page: number, totalPages: number, totalCount: number) =>
      bilingualHtml(
        `Page <b>${page}</b> of <b>${totalPages}</b> · <b>${totalCount}</b> order(s) total`,
        `ገጽ <b>${page}</b> ከ <b>${totalPages}</b> · ጠቅላላ <b>${totalCount}</b> ትዕዛዝ(ዎች)`,
      ),
    empty: () =>
      bilingualHtml(
        '<i>No orders yet. Send a SHEIN link to place your first order.</i>',
        '<i>እስካሁን ትዕዛዝ የለም። የመጀመሪያ ትዕዛዝዎን ለመስጠት የSHEIN ሊንክ ይላኩ።</i>',
      ),
    footer: () =>
      bilingualHtml(
        '<i>Send a SHEIN link to place a new order.</i>',
        '<i>አዲስ ትዕዛዝ ለመስጠት የSHEIN ሊንክ ይላኩ።</i>',
      ),
    stageLabel: () => bilingual('Stage', 'ደረጃ'),
    productLabel: () => bilingual('Product', 'ምርት'),
    variantLabel: () => bilingual('Variant', 'ዓይነት'),
    priceLabel: () => bilingual('Price', 'ዋጋ'),
    placedLabel: () => bilingual('Placed', 'ተቀምጧል'),
    linkLabel: () => bilingual('Link', 'ሊንክ'),
    viewProduct: () => bilingual('View product', 'ምርት ይመልከቱ'),
    status: (status: OrderStatus): string => {
      const map: Record<OrderStatus, [string, string]> = {
        awaiting_approval: [
          '⏳ Awaiting Medaf collation approval',
          '⏳ የMedaf collation ፈቃድ በመጠባበቅ ላይ',
        ],
        awaiting_payment: [
          '💳 Awaiting your payment',
          '💳 ክፍያዎ በመጠባበቅ ላይ',
        ],
        pending: ['📦 Confirmed — in progress', '📦 ተረጋግጧል — በሂደት ላይ'],
        shipping: ['🚚 Shipping — on the way', '🚚 በመላክ ላይ — በመንገድ ላይ'],
        completed: ['✓ Completed', '✓ ተጠናቋል'],
        cancelled: ['✗ Cancelled', '✗ ተሰርዟል'],
      };
      const pair = map[status];
      return pair ? bilingual(pair[0], pair[1]) : status;
    },
  },

  release: {
    body: () =>
      bilingualHtml(
        [
          '🎉 <b>Medaf Bot v2.0 is live!</b>',
          '',
          'We\u2019ve updated the bot to make ordering clearer and pricing fairer. Here\u2019s what\u2019s new:',
          '',
          '━━━━━━━━━━━━━━━━',
          '',
          '💰 <b>Better cost management</b>',
          'Medaf collation reviews every order before you pay. If we can lower the price, you\u2019ll get a discount 🎁. If our estimate was off, we\u2019ll explain a small price correction politely.',
          '',
          '💳 <b>Simpler payments</b>',
          'After approval, transfer <b>50%</b> to our bank account and tap <b>✅ Paid</b> in the bot. Your order is confirmed right away.',
          '',
          '📋 <b>See your orders</b>',
          'Check all your orders and their status anytime — use the <b>My orders</b> button at the bottom of your chat.',
          '',
          '🔄 <b>Important — tap Update</b>',
          'Please tap <b>🔄 Update</b> at the bottom of your chat to refresh the bot and load v2.0.',
          '',
          '━━━━━━━━━━━━━━━━',
          '',
          '🙏 Thank you for ordering with <b>Medaf collation</b>.',
        ].join('\n'),
        [
          '🎉 <b>Medaf Bot v2.0 ተጀምሯል!</b>',
          '',
          'ትዕዛዝን የበለጠ ግልጽ እና ዋጋን ፍትሃዊ ለማድረግ ቦቱን አዘምነናል። አዲሱ ምንድን ነው፡',
          '',
          '━━━━━━━━━━━━━━━━',
          '',
          '💰 <b>የተሻለ ወጪ አስተዳደር</b>',
          'ከመክፈልዎ በፊት Medaf collation እያንዳንዱን ትዕዛዝ ይመለከታል። ዋጋ ከቀነስን ቅናሽ ያገኛሉ 🎁። ግምታችን ከተሳሳተ ትንሽ የዋጋ ማስተካከል በአደናዳኝ ሁኔታ እንገልጻለን።',
          '',
          '💳 <b>ቀላል ክፍያ</b>',
          'ከጸድቋ በኋላ <b>50%</b> ወደ ባንክ መለያያችን ያስተላልፉ እና በቦቱ <b>✅ Paid</b> ይጫኑ። ትዕዛዝዎ ወዲያውኑ ይረጋገጣል።',
          '',
          '📋 <b>ትዕዛዞችዎን ይመልከቱ</b>',
          'ሁሉንም ትዕዛዞች እና ሁኔታቸውን በማንኛውም ጊዜ ይመልከቱ — በቻት ታችኛው ባር <b>My orders</b> ይጫኑ።',
          '',
          '🔄 <b>አስፈላጊ — Update ይጫኑ</b>',
          'ቦቱን ለማደስ እና v2.0 ለመጫን እባክዎ በቻት ታችኛው ባር <b>🔄 Update</b> ይጫኑ።',
          '',
          '━━━━━━━━━━━━━━━━',
          '',
          '🙏 ከ<b>Medaf collation</b> ጋር ስለሰጡን ትዕዛዝ እናመሰግናለን።',
        ].join('\n'),
      ),
  },
} as const;

/** Invalid link reasons for link-resolver classify(). */
export const linkInvalidReasons = {
  noUrl: resellerMessages.links.noUrl,
  invalidUrl: resellerMessages.links.invalidUrl,
  notSheinHost: resellerMessages.links.notSheinHost,
  notProductPage: resellerMessages.links.notProductPage,
} as const;
