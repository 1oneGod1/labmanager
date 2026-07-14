const POLICY_KEYS = new Set([
  'master_volume',
  'master_muted',
  'web_filter_enabled',
  'web_filter_mode',
  'whitelist',
  'blacklist',
  'wallpaper_url',
  'wallpaper_target',
]);

const DEFAULT_POLICY = Object.freeze({
  master_volume: 75,
  master_muted: false,
  web_filter_enabled: false,
  web_filter_mode: 'blacklist',
  whitelist: [],
  blacklist: [],
  wallpaper_url: '',
  wallpaper_target: 'both',
});

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return fallback;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value.split(/[\n,]/);
  } catch {
    return value.split(/[\n,]/);
  }
}

function normalizeDomain(value) {
  let candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return null;
  candidate = candidate.replace(/^\*\./, '');
  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    candidate = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (candidate.length > 253) return null;
  if (candidate === 'localhost') return candidate;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(candidate)) return null;
  return candidate;
}

function normalizeDomainList(value) {
  return [...new Set(parseArray(value).map(normalizeDomain).filter(Boolean))].slice(0, 100);
}

function normalizeWallpaperUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (candidate.length > 2048) return '';
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeControlSettings(input = {}, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = partial ? {} : { ...DEFAULT_POLICY };
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const shouldSet = (key) => !partial || has(key);

  if (shouldSet('master_volume')) {
    const value = Number(source.master_volume ?? DEFAULT_POLICY.master_volume);
    result.master_volume = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_POLICY.master_volume;
  }
  if (shouldSet('master_muted')) result.master_muted = parseBoolean(source.master_muted, DEFAULT_POLICY.master_muted);
  if (shouldSet('web_filter_enabled')) result.web_filter_enabled = parseBoolean(source.web_filter_enabled, DEFAULT_POLICY.web_filter_enabled);
  if (shouldSet('web_filter_mode')) result.web_filter_mode = source.web_filter_mode === 'whitelist' ? 'whitelist' : 'blacklist';
  if (shouldSet('whitelist')) result.whitelist = normalizeDomainList(source.whitelist);
  if (shouldSet('blacklist')) result.blacklist = normalizeDomainList(source.blacklist);
  if (shouldSet('wallpaper_url')) result.wallpaper_url = normalizeWallpaperUrl(source.wallpaper_url);
  if (shouldSet('wallpaper_target')) {
    result.wallpaper_target = ['login', 'desktop', 'both'].includes(source.wallpaper_target)
      ? source.wallpaper_target
      : DEFAULT_POLICY.wallpaper_target;
  }

  return Object.fromEntries(Object.entries(result).filter(([key]) => POLICY_KEYS.has(key)));
}

module.exports = {
  DEFAULT_POLICY,
  normalizeControlSettings,
  normalizeDomain,
  normalizeDomainList,
};
