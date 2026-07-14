import React from 'react';
import { brandInitials } from '../branding.js';

export default function BrandLogo({ branding, className = '', title }) {
  const label = title || `Logo ${branding?.school_name || branding?.product_name || 'aplikasi'}`;
  return (
    <div className={className} title={label} aria-label={label}>
      {branding?.logo_data_url
        ? <img src={branding.logo_data_url} alt={label} />
        : <span className="labkom-brand-fallback" style={{ background: branding?.primary_color }}>{brandInitials(branding?.product_name)}</span>}
    </div>
  );
}
