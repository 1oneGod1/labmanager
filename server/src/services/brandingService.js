const DEFAULT_BRANDING = Object.freeze({
  product_name: 'LabKom',
  school_name: 'Nama Sekolah',
  lab_name: 'Laboratorium Komputer',
  admin_label: 'Dashboard Admin',
  student_label: 'Sistem Manajemen Lab',
  support_text: 'Hubungi petugas laboratorium jika membutuhkan bantuan.',
  primary_color: '#2563eb',
  accent_color: '#f8c84f',
  logo_data_url: '',
});

const TEXT_LIMITS = Object.freeze({
  product_name: 40,
  school_name: 100,
  lab_name: 100,
  admin_label: 60,
  student_label: 80,
  support_text: 180,
});

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function normalizeText(value, fallback, maxLength) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function normalizeColor(value, fallback) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function hasExpectedSignature(mime, bytes) {
  if (mime === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function normalizeLogoDataUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return '';

  const match = String(value).trim().match(LOGO_PATTERN);
  if (!match) {
    throw new Error('Logo harus berupa PNG, JPG, atau WebP yang valid.');
  }

  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
    throw new Error('Ukuran logo maksimal 512 KB.');
  }
  if (!hasExpectedSignature(match[1], bytes)) {
    throw new Error('Isi file logo tidak sesuai dengan tipe gambarnya.');
  }
  return `data:${match[1]};base64,${bytes.toString('base64')}`;
}

function sanitizeBranding(input = {}, current = DEFAULT_BRANDING) {
  const base = { ...DEFAULT_BRANDING, ...(current || {}) };
  const result = {};

  for (const [key, maxLength] of Object.entries(TEXT_LIMITS)) {
    result[key] = normalizeText(input[key], base[key], maxLength);
  }
  result.primary_color = normalizeColor(input.primary_color, base.primary_color);
  result.accent_color = normalizeColor(input.accent_color, base.accent_color);
  const logo = normalizeLogoDataUrl(input.logo_data_url);
  result.logo_data_url = logo === undefined ? String(base.logo_data_url || '') : logo;
  return result;
}

function toPublicBranding(value = {}) {
  const sanitized = sanitizeBranding(value, DEFAULT_BRANDING);
  return {
    ...sanitized,
    updated_at: value.updated_at || null,
  };
}

module.exports = {
  DEFAULT_BRANDING,
  MAX_LOGO_BYTES,
  sanitizeBranding,
  toPublicBranding,
  normalizeLogoDataUrl,
};
