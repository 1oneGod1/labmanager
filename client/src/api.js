/**
 * api.js — Utility HTTP request untuk client LabKom
 *
 * Di Electron (file:// protocol), fetch diblokir Chromium untuk request ke
 * http://IP:3001. Solusi: route semua request lewat IPC ke main process
 * yang menggunakan Node.js http module secara langsung.
 *
 * Fallback: fetch biasa (dev mode / browser biasa).
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function normalizeTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(30_000, Math.max(1_000, Math.round(parsed)));
}

export async function settleWithin(promise, timeoutMs, timeoutValue = null) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), normalizeTimeout(timeoutMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const sourceSignal = options.signal;
  const abortFromSource = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (sourceSignal?.aborted) controller.abort();
  else sourceSignal?.addEventListener?.('abort', abortFromSource, { once: true });

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener?.('abort', abortFromSource);
  }
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

const OFFLINE_RESULT = Object.freeze({
  ok: false,
  status: 0,
  data: { success: false, message: 'Server tidak merespons. Aplikasi akan mencoba lagi otomatis.' },
});

export async function apiRequest(url, options = {}) {
  const { timeoutMs: requestedTimeout, ...requestOptions } = options;
  const timeoutMs = normalizeTimeout(requestedTimeout);

  // Gunakan IPC jika tersedia (Electron production/dev)
  if (window.electronAPI?.apiRequest) {
    const result = await settleWithin(window.electronAPI.apiRequest(url, {
      method:  requestOptions.method  || 'GET',
      headers: requestOptions.headers || {},
      body:    requestOptions.body    || null,
    }), timeoutMs, OFFLINE_RESULT);
    // Lempar error jika server return 4xx/5xx agar catch block di caller bekerja
    if (!result.ok) {
      const err = new Error(result.data?.message || (result.status ? `HTTP ${result.status}` : 'Server tidak merespons.'));
      err.status   = result.status;
      err.response = result.data;
      throw err;
    }
    return result.data;
  }

  // Fallback: fetch biasa untuk dev mode browser
  const res = await fetchWithTimeout(url, {
    ...requestOptions,
    headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) },
  }, timeoutMs);
  const data = await parseResponse(res);
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status   = res.status;
    err.response = data;
    throw err;
  }
  return data;
}

/**
 * Versi yang mengembalikan { ok, status, data } tanpa throw —
 * cocok untuk tempat yang butuh cek manual res.ok
 */
export async function apiCall(url, options = {}) {
  try {
    const { timeoutMs: requestedTimeout, ...requestOptions } = options;
    const timeoutMs = normalizeTimeout(requestedTimeout);

    if (window.electronAPI?.apiRequest) {
      return await settleWithin(window.electronAPI.apiRequest(url, {
        method:  requestOptions.method  || 'GET',
        headers: requestOptions.headers || {},
        body:    requestOptions.body    || null,
      }), timeoutMs, OFFLINE_RESULT);
    }
    const res = await fetchWithTimeout(url, {
      ...requestOptions,
      headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) },
    }, timeoutMs);
    const data = await parseResponse(res);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return OFFLINE_RESULT;
  }
}
