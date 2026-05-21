function envNum(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function pickRate(currency) {
  const upper = (currency || '').toUpperCase();
  const usd = envNum('USD_TO_ETB', null);
  const eur = envNum('EUR_TO_ETB', null);
  const gbp = envNum('GBP_TO_ETB', null);

  if (upper === 'EUR' && eur) return { rate: eur, fromCurrency: 'EUR' };
  if (upper === 'GBP' && gbp) return { rate: gbp, fromCurrency: 'GBP' };
  if (upper === 'USD' && usd) return { rate: usd, fromCurrency: 'USD' };

  if (usd) return { rate: usd, fromCurrency: 'USD' };
  return { rate: null, fromCurrency: upper || 'USD' };
}

function calculateOrderTotalEtb(product) {
  const margin = envNum('PROFIT_MARGIN', 30);
  const delivery = envNum('DELIVERY_COST_ETB', 500);

  let foreignPrice = product.price;
  let pickedCurrency = product.currency || 'USD';

  if (typeof product.priceUsd === 'number' && product.priceUsd > 0) {
    foreignPrice = product.priceUsd;
    pickedCurrency = 'USD';
  }

  const { rate, fromCurrency } = pickRate(pickedCurrency);
  if (!rate) {
    throw new Error(
      'No ETB exchange rate configured. Set USD_TO_ETB (and optionally EUR_TO_ETB, GBP_TO_ETB) in .env.',
    );
  }

  const sellingForeign = foreignPrice * (1 + margin / 100);
  const sellingEtb = sellingForeign * rate;
  const totalEtb = sellingEtb + delivery;

  return {
    totalEtb: Math.round(totalEtb),
    sellingEtb: Math.round(sellingEtb),
    deliveryEtb: Math.round(delivery),
    marginPercent: margin,
    rateUsed: rate,
    fromCurrency,
  };
}

function formatEtb(n) {
  return Math.round(n).toLocaleString('en-US') + ' ETB';
}

module.exports = { calculateOrderTotalEtb, formatEtb };
