import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Agent } from 'http';

export function buildAgent(proxyUrl: string): Agent | undefined {
  if (!proxyUrl) return undefined;
  try {
    if (/^socks/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
    return new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    const e = err as Error;
    console.error(`Invalid PROXY_URL "${proxyUrl}": ${e.message}`);
    return undefined;
  }
}
