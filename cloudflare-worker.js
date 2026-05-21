/**
 * Cloudflare Worker: a private reverse proxy for api.telegram.org.
 *
 * Why: in regions where Telegram is blocked (e.g. Ethiopia), the Bot API
 * domain cannot be reached directly. Cloudflare Workers run on Cloudflare's
 * edge, which is not blocked, and the free tier allows ~100k requests/day.
 *
 * Deploy steps (2 minutes, one time):
 *   1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create application
 *      -> Create Worker. Give it a name like "tg-proxy".
 *   2. Click "Quick edit", delete the template, paste the code below, click "Save and deploy".
 *   3. Copy the worker URL (looks like https://tg-proxy.<your-subdomain>.workers.dev).
 *   4. In .env set:
 *        TELEGRAM_API_ROOT=https://tg-proxy.<your-subdomain>.workers.dev
 *   5. Restart the bot.
 *
 * Security: the worker is on your own Cloudflare account, so nobody else
 * can see your bot token. Do NOT share this URL publicly.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.host = 'api.telegram.org';
    url.port = '';

    const proxied = new Request(url.toString(), request);
    proxied.headers.set('Host', 'api.telegram.org');

    return fetch(proxied);
  },
};
