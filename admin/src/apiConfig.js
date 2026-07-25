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

function headersToObject(headers = {}) {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers && typeof headers === 'object' ? { ...headers } : {};
}

function createIpcResponse(result = {}) {
  const status = Number(result.status) || 0;
  const body = result.data ?? {};
  return {
    ok: result.ok === true,
    status,
    headers: result.headers || {},
    netSupportBypass: result.intercepted === true,
    json: async () => {
      if (typeof body !== 'string') return body;
      return body ? JSON.parse(body) : {};
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

export async function adminFetch(resource, options = {}) {
  const desktopRequest = typeof window !== 'undefined'
    && typeof window.electronAPI?.adminApiRequest === 'function';
  if (!desktopRequest) return globalThis.fetch(resource, options);

  if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const parsed = new URL(String(resource || ''), API_BASE || window.location.origin);
  const apiPath = `${parsed.pathname}${parsed.search}`;
  const result = await window.electronAPI.adminApiRequest(apiPath, {
    method: options.method || 'GET',
    headers: headersToObject(options.headers),
    body: typeof options.body === 'string' ? options.body : '',
    timeoutMs: 10_000,
  });
  if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  return createIpcResponse(result);
}

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
    const response = await adminFetch(`${API_BASE}${path}`, {
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
