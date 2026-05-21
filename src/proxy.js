const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

function buildAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    if (/^socks/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
    return new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    console.error(`Invalid PROXY_URL "${proxyUrl}": ${err.message}`);
    return undefined;
  }
}

module.exports = { buildAgent };
