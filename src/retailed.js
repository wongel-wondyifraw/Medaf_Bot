const axios = require('axios');

const RETAILED_BASE = 'https://app.retailed.io/api/v1/scraper/shein/product';

function inferCurrency(rawPrice) {
  if (typeof rawPrice !== 'string') return null;
  if (rawPrice.includes('€')) return 'EUR';
  if (rawPrice.includes('£')) return 'GBP';
  if (/R\$/.test(rawPrice)) return 'BRL';
  if (rawPrice.includes('¥')) return 'JPY';
  if (rawPrice.includes('$')) return 'USD';
  return null;
}

function parsePriceValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function extractProductId(input) {
  if (!input) return null;
  const m = String(input).match(/-p-(\d+)\.html/i);
  if (m) return m[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

async function scrapeWithRetailed(url) {
  const apiKey = process.env.RETAILED_API_KEY;
  if (!apiKey) {
    throw new Error('RETAILED_API_KEY is missing from .env. Sign up at https://retailed.io and request access to the Shein endpoint.');
  }

  const productId = extractProductId(url);
  if (!productId) {
    throw new Error('Could not extract product ID from the URL for Retailed.io.');
  }

  let body;
  try {
    const res = await axios.get(RETAILED_BASE, {
      params: { productId },
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (res.status === 401 || res.status === 403) {
      const msg = typeof res.data === 'object' ? (res.data.message || JSON.stringify(res.data)) : res.data;
      throw new Error(
        `Retailed.io rejected the request (HTTP ${res.status}): ${msg || 'access denied'}. ` +
        `Note: the Shein endpoint requires manual access approval at retailed.io.`,
      );
    }
    if (res.status === 402) throw new Error('Retailed.io: out of credits (402). Top up at retailed.io.');
    if (res.status === 429) throw new Error('Retailed.io rate limit hit (429). Try again in a moment.');
    if (res.status >= 400) {
      const msg = typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 300) : String(res.data).slice(0, 300);
      throw new Error(`Retailed.io failed (HTTP ${res.status}): ${msg}`);
    }

    body = res.data;
  } catch (err) {
    if (err.message && err.message.startsWith('Retailed.io')) throw err;
    const code = err.code || '';
    if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
      const wrapped = new Error(`Network error reaching Retailed.io (${code}). Is the VPN/proxy reachable?`);
      wrapped.code = code;
      wrapped.cause = err;
      throw wrapped;
    }
    throw new Error(`Retailed.io request failed: ${err.message}`);
  }

  if (!body || typeof body !== 'object') {
    throw new Error('Retailed.io returned an empty or non-JSON response.');
  }

  const rawPrice = body.price || body.salePrice || body.currentPrice;
  const priceValue = parsePriceValue(rawPrice);
  if (priceValue == null) {
    throw new Error('Retailed.io response did not contain a recognizable price.');
  }

  const images = Array.isArray(body.images) ? body.images : [];
  const firstImage = images[0] && (images[0].url || images[0]);

  return {
    title: body.name || body.title || 'Unknown product',
    price: priceValue,
    priceRaw: typeof rawPrice === 'string' ? rawPrice : null,
    priceUsd: null,
    priceUsdRaw: null,
    originalPrice: parsePriceValue(body.originalPrice),
    originalPriceRaw: typeof body.originalPrice === 'string' ? body.originalPrice : null,
    onSale: !!body.onSale,
    currency: inferCurrency(typeof rawPrice === 'string' ? rawPrice : ''),
    inStock: body.inStock !== false,
    image: firstImage || null,
    productId,
    domain: new URL(url).hostname.toLowerCase(),
    source: 'retailed',
  };
}

module.exports = { scrapeWithRetailed };
