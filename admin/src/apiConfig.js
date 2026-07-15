export const DESKTOP_PROTOCOLS = new Set(['file:', 'labkom:']);

export function getApiBase(protocol = '') {
  return DESKTOP_PROTOCOLS.has(String(protocol || '').toLowerCase())
    ? 'http://localhost:3001'
    : '';
}

export const API_BASE = typeof window !== 'undefined'
  ? getApiBase(window.location.protocol)
  : '';

export const REALTIME_API = API_BASE || 'http://localhost:3001';

export async function adminJsonRequest(path, options = {}) {
  const {
    timeoutMs = 10_000,
    headers = {},
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const token = sessionStorage.getItem('admin_token');

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Respons backend tidak valid (HTTP ${response.status}).`);
    }
    if (response.status === 401) sessionStorage.removeItem('admin_token');
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Backend Admin tidak merespons dalam 10 detik.');
    if (error instanceof TypeError) throw new Error('Backend Admin tidak dapat dihubungi di localhost:3001.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
