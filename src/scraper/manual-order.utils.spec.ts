import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SharePreviewResult } from './share-preview.service';
import {
  pickOrderLinkFromResolution,
  resolveManualProductFromLink,
} from './manual-order.utils';

describe('manual-order.utils', () => {
  const productPage =
    'https://us.shein.com/Men-s-Linen-Pants-p-12345678.html';

  it('prefers og title from link resolution over message text', () => {
    const preview: SharePreviewResult = {
      title: 'Linen Blend Casual Pants',
      image: 'https://img.shein.com/example.jpg',
      productId: '12345678',
      canonicalUrl: productPage,
    };

    const resolved = resolveManualProductFromLink(
      'https://onelink.shein.com/41/abc',
      null,
      preview,
    );

    assert.equal(resolved?.productTitle, 'Linen Blend Casual Pants');
    assert.equal(resolved?.productId, '12345678');
    assert.equal(resolved?.orderLink, productPage);
    assert.equal(resolved?.imageUrl, preview.image);
  });

  it('falls back to slug from canonical URL when og title is missing', () => {
    const preview: SharePreviewResult = {
      title: null,
      image: null,
      productId: '12345678',
      canonicalUrl: productPage,
    };

    const resolved = resolveManualProductFromLink(
      'https://onelink.shein.com/41/abc',
      null,
      preview,
    );

    assert.equal(resolved?.productTitle, "Men's Linen Pants");
    assert.equal(resolved?.orderLink, productPage);
  });

  it('pickOrderLinkFromResolution prefers normalized product page', () => {
    const link = pickOrderLinkFromResolution(
      'https://onelink.shein.com/41/abc',
      productPage,
    );
    assert.equal(link, productPage);
  });
});
