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

export function normalizeBranding(value = {}) {
  return { ...DEFAULT_BRANDING, ...(value || {}) };
}

export function brandInitials(value = DEFAULT_BRANDING.product_name) {
  const words = String(value || 'LK').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'LK';
}
