import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractSheinUrlFromText,
  matchSheinLinkType,
} from './shein-link-types';

describe('shein-link-types', () => {
  const oneLinkMessage = [
    '40/20/10/5pcs Sponge Nail Files And Buffing Blocks',
    'I discovered amazing products on SHEIN.com, come check them out!',
    'https://onelink.shein.com/41/5uvloicgzal3',
  ].join('\n');

  it('recognizes onelink.shein.com URLs', () => {
    const url = extractSheinUrlFromText(oneLinkMessage);
    assert.equal(url, 'https://onelink.shein.com/41/5uvloicgzal3');

    const match = matchSheinLinkType(url!);
    assert.equal(match?.typeId, 'onelink');
    assert.equal(match?.label, 'SHEIN one-link');
    assert.equal(match?.productId, null);
  });

  it('prefers product pages when both are present', () => {
    const text =
      'https://onelink.shein.com/41/abc https://us.shein.com/Foo-p-12345.html';
    const url = extractSheinUrlFromText(text);
    assert.match(url!, /-p-12345\.html/);
  });

  it('still recognizes classic product URLs', () => {
    const match = matchSheinLinkType(
      'https://us.shein.com/Some-Product-Name-p-12345678.html',
    );
    assert.equal(match?.typeId, 'product-page');
    assert.equal(match?.productId, '12345678');
  });
});
