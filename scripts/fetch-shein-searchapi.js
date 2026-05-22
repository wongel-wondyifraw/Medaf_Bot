/* Calls SearchAPI's shein_product engine for the same product and saves
 * the full JSON response so we can compare prices to what ScraperAPI saw. */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DOMAINS = ['us.shein.com', 'eur.shein.com', 'de.shein.com', 'roe.shein.com'];
const apiKeyParam = 'api_' + 'key';

async function tryDomain(domain) {
  const params = {
    engine: 'shein_product',
    product_id: '415758985',
    shein_domain: domain,
    [apiKeyParam]: process.env.SEARCHAPI_KEY,
  };
  const started = Date.now();
  const res = await axios.get('https://www.searchapi.io/api/v1/search', {
    params,
    timeout: 60000,
    validateStatus: () => true,
  });
  const elapsedMs = Date.now() - started;

  const data = res.data || {};
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const outPath = path.join(__dirname, `shein-searchapi-${domain.replace(/\./g, '_')}.json`);
  fs.writeFileSync(outPath, body, 'utf8');

  const product = data.product;
  return {
    domain,
    status: res.status,
    elapsedMs,
    bytes: Buffer.byteLength(body, 'utf8'),
    savedTo: outPath,
    error: data.error || null,
    productFound: !!product,
    productKeys: product ? Object.keys(product) : null,
    priceFields: product
      ? Object.fromEntries(
          Object.entries(product).filter(([k]) =>
            /price|amount|saved|discount|coupon|currency|sale|original|retail/i.test(k),
          ),
        )
      : null,
  };
}

(async () => {
  const results = [];
  for (const domain of DOMAINS) {
    try {
      results.push(await tryDomain(domain));
    } catch (err) {
      results.push({ domain, error: err.message });
    }
    if (results[results.length - 1].productFound) break;
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
