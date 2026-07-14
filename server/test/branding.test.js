const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_BRANDING,
  sanitizeBranding,
  normalizeLogoDataUrl,
} = require('../src/services/brandingService');

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('branding membersihkan teks, warna, dan mempertahankan nilai default', () => {
  const branding = sanitizeBranding({
    product_name: '  Lab  Komersial  ',
    school_name: '<Sekolah Pelanggan>',
    primary_color: '#AABBCC',
    accent_color: 'tidak-valid',
  });
  assert.equal(branding.product_name, 'Lab Komersial');
  assert.equal(branding.school_name, '<Sekolah Pelanggan>');
  assert.equal(branding.primary_color, '#aabbcc');
  assert.equal(branding.accent_color, DEFAULT_BRANDING.accent_color);
  assert.equal(branding.logo_data_url, '');
});

test('branding hanya menerima format logo raster yang diizinkan', () => {
  assert.throws(() => normalizeLogoDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPG, atau WebP/);
  assert.throws(() => normalizeLogoDataUrl('data:image/png;base64,QUJDRA=='), /tidak sesuai/);
  assert.equal(normalizeLogoDataUrl(''), '');
  assert.match(normalizeLogoDataUrl(ONE_PIXEL_PNG), /^data:image\/png;base64,/);
});
