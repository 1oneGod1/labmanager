export const DEFAULT_BRANDING = Object.freeze({
  product_name: 'LabKom',
  school_name: 'Nama Sekolah',
  lab_name: 'Laboratorium Komputer',
  admin_label: 'Dashboard Admin',
  student_label: 'Sistem Manajemen Lab',
  support_text: 'Hubungi petugas laboratorium jika membutuhkan bantuan.',
  primary_color: '#2563eb',
  accent_color: '#f8c84f',
  logo_data_url: '',
  updated_at: null,
});

const CACHE_KEY = 'labkom_branding_v1';

export function normalizeBranding(value = {}) {
  return { ...DEFAULT_BRANDING, ...(value || {}) };
}

export function loadCachedBranding() {
  try { return normalizeBranding(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); }
  catch { return { ...DEFAULT_BRANDING }; }
}

export function cacheBranding(value) {
  const branding = normalizeBranding(value);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(branding)); } catch {}
  return branding;
}

export function brandInitials(value = DEFAULT_BRANDING.product_name) {
  const words = String(value || 'LK').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'LK';
}
