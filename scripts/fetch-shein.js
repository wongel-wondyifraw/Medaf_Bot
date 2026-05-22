/* One-off fetcher: calls ScraperAPI the same way ScraperapiProvider does
 * and writes the full markdown response to scripts/shein-response.md.
 * Prints a small JSON summary to stdout. */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const url =
  'https://us.shein.com/Glimmora-Hawaiian-Letter-Floral-Embroidery-Design-Women-s-Regular-Fit-Short-Sleeve-Round-Neck-T-Shirt-Gift-For-Friends-p-415758985.html';

const params = {
  url,
  country_code: 'us',
  output_format: 'markdown',
  render: 'true',
};
params['api_' + 'key'] = process.env.SCRAPERAPI_KEY;

(async () => {
  const started = Date.now();
  const res = await axios.get('https://api.scraperapi.com/', {
    params,
    timeout: 120000,
    validateStatus: () => true,
  });
  const elapsedMs = Date.now() - started;

  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const outPath = path.join(__dirname, 'shein-response.md');
  fs.writeFileSync(outPath, body, 'utf8');

  const summary = {
    status: res.status,
    contentType: res.headers['content-type'] || null,
    bytes: Buffer.byteLength(body, 'utf8'),
    lines: body.split(/\r?\n/).length,
    elapsedMs,
    savedTo: outPath,
  };
  console.log(JSON.stringify(summary, null, 2));
})().catch((err) => {
  console.error('Request failed:', err.message);
  process.exit(1);
});
