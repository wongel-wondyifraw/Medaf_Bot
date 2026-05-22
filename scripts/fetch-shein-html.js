/* Fetches the raw rendered HTML (no markdown conversion) so we can inspect
 * SHEIN's embedded JSON hydration blob and find true price fields.
 * Saves the body to scripts/shein-response.html and prints a small summary. */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const url =
  'https://us.shein.com/Glimmora-Hawaiian-Letter-Floral-Embroidery-Design-Women-s-Regular-Fit-Short-Sleeve-Round-Neck-T-Shirt-Gift-For-Friends-p-415758985.html';

const params = {
  url,
  country_code: 'us',
  render: 'true',
};
params['api_' + 'key'] = process.env.SCRAPERAPI_KEY;

(async () => {
  const started = Date.now();
  const res = await axios.get('https://api.scraperapi.com/', {
    params,
    timeout: 120000,
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const elapsedMs = Date.now() - started;

  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const outPath = path.join(__dirname, 'shein-response.html');
  fs.writeFileSync(outPath, body, 'utf8');

  console.log(
    JSON.stringify(
      {
        status: res.status,
        contentType: res.headers['content-type'] || null,
        bytes: Buffer.byteLength(body, 'utf8'),
        lines: body.split(/\r?\n/).length,
        elapsedMs,
        savedTo: outPath,
      },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error('Request failed:', err.message);
  process.exit(1);
});
