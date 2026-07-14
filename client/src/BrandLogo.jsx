import React from 'react';
import { brandInitials } from './branding.js';

export default function BrandLogo({ branding, className = '' }) {
  const label = `Logo ${branding?.school_name || branding?.product_name || 'aplikasi'}`;
  return branding?.logo_data_url
    ? <img src={branding.logo_data_url} alt={label} className={className} />
    : <div className={`${className} grid place-items-center font-extrabold text-white`} aria-label={label} style={{ background: branding?.primary_color }}>{brandInitials(branding?.product_name)}</div>;
}
