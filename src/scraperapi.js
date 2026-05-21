const axios = require('axios');

const SCRAPERAPI_BASE = 'https://api.scraperapi.com/';

// Map Shein subdomain -> ScraperAPI country code. Helps the residential proxy
// serve the same regional storefront the user is seeing.
const HOST_TO_COUNTRY = {
  'nl.shein.com': 'nl', 'be.shein.com': 'be', 'at.shein.com': 'at',
  'ie.shein.com': 'ie', 'fi.shein.com': 'fi', 'gr.shein.com': 'gr',
  'lu.shein.com': 'lu', 'es.shein.com': 'es', 'pt.shein.com': 'pt',
  'pl.shein.com': 'pl', 'de.shein.com': 'de', 'fr.shein.com': 'fr',
  'it.shein.com': 'it', 'ch.shein.com': 'ch', 'eur.shein.com': 'de',
  'roe.shein.com': 'no', 'no.shein.com': 'no', 'dk.shein.com': 'dk',
  'cz.shein.com': 'cz', 'hu.shein.com': 'hu', 'ro.shein.com': 'ro',
  'us.shein.com': 'us', 'www.shein.com': 'us', 'm.shein.com': 'us',
  'www.shein.co.uk': 'uk', 'uk.shein.com': 'uk', 'gb.shein.com': 'uk',
  'www.shein.se': 'se', 'se.shein.com': 'se',
};

function pickCountry(hostname) {
  const host = hostname.toLowerCase();
  if (HOST_TO_COUNTRY[host]) return HOST_TO_COUNTRY[host];
  return process.env.SCRAPERAPI_COUNTRY || 'us';
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

// Extracts a price from ScraperAPI's markdown output.
// Markdown for a Shein product detail page typically contains the price near
// the top of the document, in patterns like:
//   "€12,99"  "$21.49"  "£15.00"  "12,99 €"  or as a heading like "## €12.99"
function extractPriceFromMarkdown(markdown) {
  const text = markdown.replace(/\s+/g, ' ').slice(0, 20000);

  // Look for price-like tokens with a currency symbol.
  const priceRegex = /(?:€|\$|£|R\$|¥)\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:€|\$|£|R\$|¥|EUR|USD|GBP)/gi;
  const matches = text.match(priceRegex) || [];
  if (!matches.length) return null;

  // Pick the first plausible price (skip obvious "$1" placeholders <= 1).
  for (const m of matches) {
    const value = parsePriceValue(m);
    if (value != null && value >= 0.5) {
      return { value, raw: m.trim() };
    }
  }
  return null;
}

function extractTitleFromMarkdown(markdown, url) {
  // Prefer the first H1 heading, then <title>-style first non-empty line.
  const h1 = markdown.match(/^#\s+(.+)$/m);
  if (h1 && h1[1].trim().length > 5) return h1[1].trim();

  const h2 = markdown.match(/^##\s+(.+)$/m);
  if (h2 && h2[1].trim().length > 5 && !/€|\$|£/.test(h2[1])) return h2[1].trim();

  // Fall back to deriving from URL slug.
  const slug = url.match(/\/([^/?]+)-p-\d+\.html/i);
  if (slug) {
    return slug[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Unknown product';
}

function extractStock(markdown) {
  const lower = markdown.toLowerCase();
  if (/out of stock|sold out|niet op voorraad|uitverkocht|ausverkauft|agotado|épuisé/.test(lower)) return false;
  return true;
}

function extractProductId(url) {
  const m = url.match(/-p-(\d+)\.html/i);
  return m ? m[1] : null;
}

// ScraperAPI mode hierarchy (cheapest -> most expensive):
//   default (1 credit)        no JS rendering, datacenter proxies     - usually too weak for Shein
//   render=true (10 credits)  JS rendering, datacenter proxies        - free tier supports this
//   premium=true (10 credits) JS rendering, residential proxies       - works for most sites
//   ultra_premium=true (75)   the works; required for hardest sites   - PAID plan only
// SCRAPERAPI_MODE in .env can be set to: render | premium | ultra_premium
// Default is "render" so the free tier works.
function buildScraperApiParams(apiKey, url, country) {
  const mode = (process.env.SCRAPERAPI_MODE || 'render').toLowerCase();
  const params = {
    api_key: apiKey,
    url,
    country_code: country,
    output_format: 'markdown',
  };
  if (mode === 'ultra_premium') params.ultra_premium = 'true';
  else if (mode === 'premium') params.premium = 'true';
  else params.render = 'true';
  return params;
}

function interpretScraperApiError(status, body) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
  const lower = bodyText.toLowerCase();

  if (status === 401) return 'ScraperAPI rejected the API key (401). Check SCRAPERAPI_KEY in .env.';
  if (status === 429) return 'ScraperAPI rate limit hit (429). Try again in a moment.';

  if (status === 403) {
    if (/ultra.premium|premium/.test(lower)) {
      return 'ScraperAPI 403: ultra_premium/premium requested but not allowed on your plan. Set SCRAPERAPI_MODE=render in .env, or upgrade your plan.';
    }
    if (/credit|quota|exceeded|limit/.test(lower)) {
      return 'ScraperAPI 403: account out of credits. Check your dashboard at scraperapi.com.';
    }
    if (/invalid|api.?key|unauthorized/.test(lower)) {
      return 'ScraperAPI 403: API key was rejected. Double-check SCRAPERAPI_KEY in .env.';
    }
    return `ScraperAPI 403: ${bodyText.slice(0, 200) || 'forbidden (could be plan limitation, blocked URL, or geo restriction).'}`;
  }

  return `ScraperAPI failed (HTTP ${status}): ${bodyText.slice(0, 200)}`;
}

async function scrapeWithScraperApi(url) {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) throw new Error('SCRAPERAPI_KEY is missing from .env. Get a key at https://www.scraperapi.com and paste it in.');

  const parsed = new URL(url);
  const country = pickCountry(parsed.hostname);
  const params = buildScraperApiParams(apiKey, url, country);

  let body;
  try {
    const res = await axios.get(SCRAPERAPI_BASE, {
      params,
      timeout: 90000,
      validateStatus: () => true,
    });

    if (res.status >= 400) {
      throw new Error(interpretScraperApiError(res.status, res.data));
    }

    body = typeof res.data === 'string' ? res.data : String(res.data);
  } catch (err) {
    if (err.message && err.message.startsWith('ScraperAPI')) throw err;
    const code = err.code || '';
    if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
      const wrapped = new Error(`Network error reaching ScraperAPI (${code}). Is the VPN/proxy reachable?`);
      wrapped.code = code;
      wrapped.cause = err;
      throw wrapped;
    }
    throw new Error(`ScraperAPI request failed: ${err.message}`);
  }

  if (!body || body.length < 100) {
    throw new Error('ScraperAPI returned an empty page. The product link may be invalid.');
  }

  const priceInfo = extractPriceFromMarkdown(body);
  if (!priceInfo) {
    throw new Error('ScraperAPI fetched the page but no price could be parsed from it.');
  }

  return {
    title: extractTitleFromMarkdown(body, url),
    price: priceInfo.value,
    priceRaw: priceInfo.raw,
    priceUsd: null,
    priceUsdRaw: null,
    originalPrice: null,
    originalPriceRaw: null,
    onSale: false,
    currency: inferCurrency(priceInfo.raw),
    inStock: extractStock(body),
    image: null,
    productId: extractProductId(url),
    domain: parsed.hostname.toLowerCase(),
    source: 'scraperapi',
  };
}

module.exports = { scrapeWithScraperApi };
