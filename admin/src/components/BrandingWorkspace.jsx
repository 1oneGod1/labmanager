import React, { useEffect, useRef, useState } from 'react';
import { Building2, Image as ImageIcon, Loader2, Palette, RotateCcw, Save, ShieldCheck, Upload } from 'lucide-react';
import BrandLogo from './BrandLogo.jsx';
import { DEFAULT_BRANDING, normalizeBranding } from '../branding.js';

const MAX_LOGO_BYTES = 512 * 1024;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Logo tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}

export default function BrandingWorkspace({ branding, onSave }) {
  const [draft, setDraft] = useState(() => normalizeBranding(branding));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => setDraft(normalizeBranding(branding)), [branding]);

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const chooseLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError('Gunakan logo PNG, JPG, atau WebP. SVG tidak diizinkan demi keamanan.');
      return;
    }
    if (!file.size || file.size > MAX_LOGO_BYTES) {
      setError('Ukuran logo maksimal 512 KB.');
      return;
    }
    try {
      update('logo_data_url', await fileToDataUrl(file));
      setError('');
    } catch (fileError) {
      setError(fileError.message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const result = await onSave(draft);
    setSaving(false);
    if (!result?.success) setError(result?.message || 'Identitas aplikasi tidak dapat disimpan.');
  };

  const resetGeneric = () => {
    setDraft({ ...DEFAULT_BRANDING });
    setError('');
  };

  return (
    <section className="labkom-branding">
      <header className="labkom-page-heading">
        <div><h2>Identitas & White-label</h2><p>Ubah nama, logo, dan warna untuk seluruh aplikasi Admin dan Siswa.</p></div>
        <div className="labkom-branding-actions">
          <button type="button" className="labkom-branding-secondary" onClick={resetGeneric}><RotateCcw /> Reset generik</button>
          <button type="button" className="labkom-primary" onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Simpan identitas</button>
        </div>
      </header>

      <div className="labkom-branding-grid">
        <div className="labkom-branding-form">
          <article className="labkom-branding-card">
            <div className="labkom-branding-card-title"><Building2 /><div><h3>Nama organisasi</h3><p>Teks ini tampil otomatis di kedua aplikasi.</p></div></div>
            <div className="labkom-branding-fields">
              <label><span>Nama produk</span><input value={draft.product_name} maxLength={40} onChange={(event) => update('product_name', event.target.value)} placeholder="LabKom" /></label>
              <label><span>Nama sekolah / instansi</span><input value={draft.school_name} maxLength={100} onChange={(event) => update('school_name', event.target.value)} placeholder="Nama Sekolah" /></label>
              <label><span>Nama laboratorium</span><input value={draft.lab_name} maxLength={100} onChange={(event) => update('lab_name', event.target.value)} placeholder="Laboratorium Komputer" /></label>
              <label><span>Label aplikasi Admin</span><input value={draft.admin_label} maxLength={60} onChange={(event) => update('admin_label', event.target.value)} placeholder="Dashboard Admin" /></label>
              <label className="is-wide"><span>Judul layar siswa</span><input value={draft.student_label} maxLength={80} onChange={(event) => update('student_label', event.target.value)} placeholder="Sistem Manajemen Lab" /></label>
              <label className="is-wide"><span>Kontak / teks bantuan</span><textarea value={draft.support_text} maxLength={180} rows={3} onChange={(event) => update('support_text', event.target.value)} /></label>
            </div>
          </article>

          <article className="labkom-branding-card">
            <div className="labkom-branding-card-title"><Palette /><div><h3>Logo & warna</h3><p>Logo tersimpan lokal di database pelanggan.</p></div></div>
            <div className="labkom-branding-logo-row">
              <BrandLogo branding={draft} className="labkom-branding-logo" />
              <div><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseLogo} />
                <button type="button" className="labkom-branding-upload" onClick={() => fileRef.current?.click()}><Upload /> Pilih logo</button>
                {draft.logo_data_url && <button type="button" className="labkom-branding-remove" onClick={() => update('logo_data_url', '')}>Hapus logo</button>}
                <small>PNG, JPG, atau WebP · maksimal 512 KB.</small>
              </div>
            </div>
            <div className="labkom-branding-colors">
              <label><span>Warna utama</span><div><input type="color" value={draft.primary_color} onChange={(event) => update('primary_color', event.target.value)} /><code>{draft.primary_color}</code></div></label>
              <label><span>Warna aksen</span><div><input type="color" value={draft.accent_color} onChange={(event) => update('accent_color', event.target.value)} /><code>{draft.accent_color}</code></div></label>
            </div>
          </article>

          {error && <div className="labkom-branding-error">{error}</div>}
          <div className="labkom-branding-security"><ShieldCheck /><div><strong>Aman untuk distribusi pelanggan</strong><p>Logo raster divalidasi, data branding tidak mengandung script, dan perubahan hanya dapat dilakukan setelah login Admin.</p></div></div>
        </div>

        <aside className="labkom-branding-preview" style={{ '--preview-primary': draft.primary_color, '--preview-accent': draft.accent_color }}>
          <div className="labkom-branding-preview-label"><ImageIcon /> Pratinjau langsung</div>
          <div className="labkom-branding-preview-window">
            <div className="labkom-branding-preview-top"><BrandLogo branding={draft} className="labkom-branding-preview-logo" /><div><strong>{draft.product_name} Admin</strong><span>{draft.school_name}</span></div></div>
            <div className="labkom-branding-preview-body"><small>{draft.lab_name}</small><h3>{draft.admin_label}</h3><p>{draft.student_label}</p><button type="button">Masuk ke Dashboard</button></div>
          </div>
          <p>Perubahan diterapkan ke Admin dan dikirim ke PC siswa melalui server lokal.</p>
        </aside>
      </div>
    </section>
  );
}
