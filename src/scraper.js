const axios = require('axios');

const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SearchAPI only accepts a fixed list of shein_domain values.
// Every other regional Shein subdomain is mapped to its nearest equivalent here.
// Source: HTTP 400 response from the API itself.
const SUPPORTED_DOMAINS = new Set([
  'us.shein.com',
  'roe.shein.com',
  'de.shein.com',
  'eur.shein.com',
  'fr.shein.com',
  'it.shein.com',
  'ch.shein.com',
  'pl.shein.com',
  'pt.shein.com',
  'es.shein.com',
  'www.shein.se',
  'www.shein.co.uk',
]);

const DOMAIN_ALIASES = {
  // Eurozone countries without a dedicated storefront -> generic EUR site.
  'nl.shein.com': 'eur.shein.com',
  'be.shein.com': 'eur.shein.com',
  'at.shein.com': 'eur.shein.com',
  'ie.shein.com': 'eur.shein.com',
  'fi.shein.com': 'eur.shein.com',
  'gr.shein.com': 'eur.shein.com',
  'lu.shein.com': 'eur.shein.com',
  'sk.shein.com': 'eur.shein.com',
  'si.shein.com': 'eur.shein.com',
  'ee.shein.com': 'eur.shein.com',
  'lv.shein.com': 'eur.shein.com',
  'lt.shein.com': 'eur.shein.com',
  'mt.shein.com': 'eur.shein.com',
  'cy.shein.com': 'eur.shein.com',

  // Non-EU European countries that use Shein's "Rest of Europe" storefront.
  'no.shein.com': 'roe.shein.com',
  'dk.shein.com': 'roe.shein.com',
  'cz.shein.com': 'roe.shein.com',
  'hu.shein.com': 'roe.shein.com',
  'ro.shein.com': 'roe.shein.com',
  'bg.shein.com': 'roe.shein.com',
  'hr.shein.com': 'roe.shein.com',

  // Common aliases for primary regions.
  'www.shein.com': 'us.shein.com',
  'm.shein.com': 'us.shein.com',
  'uk.shein.com': 'www.shein.co.uk',
  'gb.shein.com': 'www.shein.co.uk',
  'se.shein.com': 'www.shein.se',
};

const FALLBACK_DOMAINS = [
  'eur.shein.com',
  'de.shein.com',
  'fr.shein.com',
  'it.shein.com',
  'es.shein.com',
  'pt.shein.com',
  'pl.shein.com',
  'roe.shein.com',
  'us.shein.com',
  'www.shein.co.uk',
  'www.shein.se',
  'ch.shein.com',
];

function mapDomain(hostname) {
  const host = hostname.toLowerCase();
  if (SUPPORTED_DOMAINS.has(host)) return host;
  if (DOMAIN_ALIASES[host]) return DOMAIN_ALIASES[host];
  // Last-resort fallback: any other regional .shein.com goes to the generic Euro site.
  if (host.endsWith('.shein.com')) return 'eur.shein.com';
  return 'us.shein.com';
}

function parseShein(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error('That does not look like a valid URL.');
  }

  if (!/shein\.com$/i.test(parsed.hostname)) {
    throw new Error('URL is not a shein.com link.');
  }

  const idMatch = parsed.pathname.match(/-p-(\d+)\.html$/i);
  if (!idMatch) {
    throw new Error(
      'Could not find the product ID in the URL. Make sure you sent a product detail page (ends with "-p-<number>.html").',
    );
  }

  return { productId: idMatch[1], domain: parsed.hostname.toLowerCase() };
}

function parsePriceValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function inferCurrency(rawPrice) {
  if (typeof rawPrice !== 'string') return null;
  if (rawPrice.includes('€')) return 'EUR';
  if (rawPrice.includes('£')) return 'GBP';
  if (/R\$/.test(rawPrice)) return 'BRL';
  if (rawPrice.includes('¥')) return 'JPY';
  if (rawPrice.includes('$')) return 'USD';
  return null;
}

/**
 * Extracts the current (sale) price from a SearchAPI Shein product object.
 * Real schema (see https://www.searchapi.io/docs/shein-product-api):
 *   product.price             -> "$21.49"   (localized raw string)
 *   product.extracted_price   -> 21.49      (numeric, localized currency)
 *   product.price_usd         -> "$21.49"   (USD raw string)
 *   product.extracted_price_usd -> 21.49    (numeric, always USD)
 *   product.original_price / extracted_original_price -> pre-discount
 */
function extractPrice(product) {
  let value = null;
  let raw = null;

  if (typeof product.extracted_price === 'number' && Number.isFinite(product.extracted_price)) {
    value = product.extracted_price;
  }
  if (typeof product.price === 'string') raw = product.price;

  if (value == null) value = parsePriceValue(product.price);

  if (value == null) {
    const fallbackKeys = ['sale_price', 'current_price', 'final_price'];
    for (const k of fallbackKeys) {
      const v = product[k];
      if (v == null) continue;
      if (typeof v === 'number' && Number.isFinite(v)) { value = v; break; }
      if (typeof v === 'string') {
        const n = parsePriceValue(v);
        if (n != null) { value = n; raw = raw || v; break; }
      }
      if (typeof v === 'object') {
        if (typeof v.value === 'number') { value = v.value; raw = raw || v.raw || null; break; }
        const n = parsePriceValue(v.raw || v.display);
        if (n != null) { value = n; raw = raw || v.raw || v.display || null; break; }
      }
    }
  }

  if (value == null) return null;

  return {
    value,
    raw,
    valueUsd: typeof product.extracted_price_usd === 'number' ? product.extracted_price_usd : null,
    rawUsd: typeof product.price_usd === 'string' ? product.price_usd : null,
    originalValue: typeof product.extracted_original_price === 'number' ? product.extracted_original_price : null,
    originalRaw: typeof product.original_price === 'string' ? product.original_price : null,
    onSale: !!product.is_on_sale,
  };
}

function apiErrorMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return body.error || body.message || '';
}

function buildSearchApiError(err, domain) {
  const status = err.response && err.response.status;
  const body = err.response && err.response.data;
  const apiMsg = apiErrorMessage(body);

  if (status === 401) return new Error('SearchAPI rejected the API key (401). Check SEARCHAPI_KEY in .env.');
  if (status === 402) return new Error('SearchAPI plan limit reached (402). Top up at searchapi.io.');
  if (status === 404) return new Error(`SearchAPI could not find that product on ${domain} (404). Double-check the link.`);
  if (status === 429) return new Error('SearchAPI rate limit hit (429). Try again in a moment.');

  const code = err.code || '';
  if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
    const wrapped = new Error(`Network error reaching SearchAPI (${code}). Is the VPN/proxy reachable?`);
    wrapped.code = code;
    wrapped.cause = err;
    return wrapped;
  }

  return new Error(
    `SearchAPI request failed${status ? ' (HTTP ' + status + ')' : ''}` +
      `${apiMsg ? ': ' + apiMsg : ''}` +
      ` [domain: ${domain}]`,
  );
}

function shouldTryNextDomain(err) {
  const status = err.response && err.response.status;
  const msg = apiErrorMessage(err.response && err.response.data);
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    (status === 400 && /unsupported value/i.test(msg)) ||
    (status === 404 && /not found/i.test(msg))
  );
}

async function scrapeProduct(url) {
  const apiKey = process.env.SEARCHAPI_KEY;
  if (!apiKey) {
    throw new Error('SEARCHAPI_KEY is missing from .env. Get a key at https://www.searchapi.io and paste it in.');
  }

  const { productId, domain } = parseShein(url);
  const requestedDomain = process.env.SHEIN_DOMAIN || domain;
  const sheinDomain = mapDomain(requestedDomain);
  const domainsToTry = [
    sheinDomain,
    ...FALLBACK_DOMAINS.filter((fallbackDomain) => fallbackDomain !== sheinDomain),
  ];
  const currency = process.env.SHEIN_CURRENCY || '';

  let data;
  let usedDomain = sheinDomain;
  const attempts = [];
  let lastError;

  for (const domainToTry of domainsToTry) {
    const params = {
      engine: 'shein_product',
      product_id: productId,
      shein_domain: domainToTry,
      api_key: apiKey,
    };
    if (currency) params.currency = currency;

    let attemptSucceeded = false;
    let attemptOutcome;

    for (let retry = 0; retry < 2; retry++) {
      try {
        const res = await axios.get(SEARCHAPI_BASE, {
          params,
          timeout: 30000,
          validateStatus: () => true,
        });
        const body = res.data;
        const apiMsg = apiErrorMessage(body);

        if (res.status === 503) {
          attemptOutcome = `503 ${apiMsg || 'service error'}`;
          if (retry === 0) { await sleep(800); continue; }
          break;
        }
        if (res.status >= 400) {
          const upstreamErr = { response: { status: res.status, data: body } };
          lastError = buildSearchApiError(upstreamErr, domainToTry);
          attemptOutcome = `HTTP ${res.status} ${apiMsg || ''}`.trim();
          if (!shouldTryNextDomain(upstreamErr)) {
            attempts.push(`${domainToTry}: ${attemptOutcome}`);
            throw lastError;
          }
          break;
        }
        if (body && body.product) {
          data = body;
          usedDomain = domainToTry;
          attemptSucceeded = true;
          break;
        }
        attemptOutcome = `no product (${apiMsg || 'empty result'})`;
        break;
      } catch (err) {
        if (err.message && err.message.startsWith('SearchAPI')) throw err;
        lastError = buildSearchApiError(err, domainToTry);
        attemptOutcome = err.code ? `${err.code} ${err.message}` : err.message;
        const transient = err.code && ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(err.code);
        if (transient && retry === 0) { await sleep(800); continue; }
        break;
      }
    }

    attempts.push(`${domainToTry}: ${attemptSucceeded ? 'OK' : attemptOutcome || 'unknown failure'}`);
    if (attemptSucceeded) break;
  }

  if (!data) {
    const breakdown = attempts.map((line) => '  - ' + line).join('\n');
    const all503 = attempts.every((line) => /503/.test(line));
    const headline = all503
      ? 'SearchAPI is currently down for all Shein storefronts (HTTP 503). This is an outage on SearchAPI.io, not in the bot. Try again later or email support@searchapi.io.'
      : 'SearchAPI could not return this product from any supported storefront.';
    throw new Error(`${headline}\nAttempts:\n${breakdown}`);
  }

  if (data.search_metadata && data.search_metadata.status && data.search_metadata.status !== 'Success') {
    throw new Error(`SearchAPI status "${data.search_metadata.status}" - the product may be unavailable.`);
  }

  const product = data.product;
  if (!product) {
    throw new Error('SearchAPI returned no product object. The product may not exist on any supported storefront.');
  }

  const title = product.title || product.name || 'Unknown product';
  const priceInfo = extractPrice(product);
  if (!priceInfo) {
    throw new Error('SearchAPI returned a product with no recognizable price.');
  }

  return {
    title: String(title).trim(),
    price: priceInfo.value,
    priceRaw: priceInfo.raw,
    priceUsd: priceInfo.valueUsd,
    priceUsdRaw: priceInfo.rawUsd,
    originalPrice: priceInfo.originalValue,
    originalPriceRaw: priceInfo.originalRaw,
    onSale: priceInfo.onSale,
    currency: inferCurrency(priceInfo.raw),
    inStock: product.is_in_stock !== false,
    image: product.main_image || (product.images && product.images[0]) || null,
    productId,
    domain: usedDomain,
  };
}

module.exports = { scrapeProduct, parseShein };
