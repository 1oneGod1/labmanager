const http = require('http');
const https = require('https');
const net = require('net');

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function sanitizeHeaders(headers = {}) {
  const result = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || '').trim();
    const value = String(rawValue ?? '').trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    if (/^[\r\n]|[\r\n]/.test(value)) continue;
    if (['host', 'connection', 'content-length'].includes(name.toLowerCase())) continue;
    result[name] = value.slice(0, 8192);
  }
  return result;
}

function parseHeaderBlock(text) {
  const headers = {};
  for (const line of String(text || '').split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

function decodeChunked(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset, 'ascii');
    if (lineEnd < 0) throw new Error('Chunk HTTP tidak lengkap.');
    const sizeText = buffer.slice(offset, lineEnd).toString('ascii').split(';')[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) throw new Error('Ukuran chunk HTTP tidak valid.');
    offset = lineEnd + 2;
    if (size === 0) return Buffer.concat(chunks);
    if (offset + size + 2 > buffer.length) throw new Error('Isi chunk HTTP tidak lengkap.');
    chunks.push(buffer.slice(offset, offset + size));
    offset += size + 2;
  }
  throw new Error('Akhir chunk HTTP tidak ditemukan.');
}

function parseMessage(buffer, { statusLineRequired = true } = {}) {
  const headerEnd = buffer.indexOf('\r\n\r\n', 0, 'ascii');
  if (headerEnd < 0) throw new Error('Header HTTP tidak lengkap.');
  const headerText = buffer.slice(0, headerEnd).toString('latin1');
  const lines = headerText.split('\r\n');
  let statusCode = 0;
  if (/^HTTP\/\d\.\d\s+\d{3}/i.test(lines[0])) {
    statusCode = Number(lines.shift().split(/\s+/)[1]) || 0;
  } else if (statusLineRequired) {
    throw new Error('Status HTTP tidak ditemukan.');
  }
  const headers = parseHeaderBlock(lines.join('\r\n'));
  const rawBody = buffer.slice(headerEnd + 4);
  let bodyBuffer = rawBody;
  if (/chunked/i.test(headers['transfer-encoding'] || '')) {
    bodyBuffer = decodeChunked(rawBody);
  } else if (/^\d+$/.test(headers['content-length'] || '')) {
    bodyBuffer = rawBody.slice(0, Number(headers['content-length']));
  }
  if (!statusCode) statusCode = Number(headers['x-labkom-status']) || 200;
  return { statusCode, headers, bodyBuffer, consumed: headerEnd + 4 + rawBody.length };
}

function parseRawHttpResponse(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || '');
  const firstHeaderEnd = buffer.indexOf('\r\n\r\n', 0, 'ascii');
  if (firstHeaderEnd < 0) throw new Error('Respons HTTP kosong atau tidak lengkap.');
  const firstHeadersText = buffer.slice(0, firstHeaderEnd).toString('latin1');
  const firstHeaders = parseHeaderBlock(firstHeadersText.split('\r\n').slice(1).join('\r\n'));
  const firstLength = Number(firstHeaders['content-length']);
  const firstBodyStart = firstHeaderEnd + 4;
  const firstBodyEnd = Number.isFinite(firstLength) && firstLength >= 0
    ? Math.min(buffer.length, firstBodyStart + firstLength)
    : buffer.length;
  const firstBody = buffer.slice(firstBodyStart, firstBodyEnd);
  const intercepted = firstBody.includes(Buffer.from('ApprovedWebList.htm'));

  if (!intercepted) {
    const parsed = parseMessage(buffer);
    return {
      statusCode: parsed.statusCode,
      headers: parsed.headers,
      body: parsed.bodyBuffer.toString('utf8'),
      intercepted: false,
    };
  }

  let trailing = buffer.slice(firstBodyEnd);
  while (trailing.length && (trailing[0] === 0 || trailing[0] === 10 || trailing[0] === 13)) {
    trailing = trailing.slice(1);
  }
  const parsed = parseMessage(trailing, { statusLineRequired: false });
  return {
    statusCode: parsed.statusCode,
    headers: parsed.headers,
    body: parsed.bodyBuffer.toString('utf8'),
    intercepted: true,
  };
}

function requestRawHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url instanceof URL ? url : new URL(url);
    if (parsed.protocol !== 'http:') return reject(new Error('Raw request hanya mendukung HTTP.'));
    const method = String(options.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return reject(new Error('Method HTTP tidak diizinkan.'));
    const body = typeof options.body === 'string' ? options.body : '';
    const bodyBuffer = Buffer.from(body, 'utf8');
    const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
    const timeoutMs = Math.max(500, Number(options.timeoutMs) || 8000);
    const port = Number(parsed.port) || 80;
    const hostHeader = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname;
    const headers = sanitizeHeaders(options.headers);
    if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';
    if (bodyBuffer.length && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const lines = [
      `${method} ${parsed.pathname || '/'}${parsed.search || ''} HTTP/1.1`,
      `Host: ${hostHeader}:${port}`,
      'Connection: close',
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      ...(bodyBuffer.length ? [`Content-Length: ${bodyBuffer.length}`] : []),
      '',
      '',
    ];
    const socket = net.createConnection({ host: parsed.hostname, port });
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else {
        try { resolve(parseRawHttpResponse(Buffer.concat(chunks))); }
        catch (parseError) { reject(parseError); }
      }
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('Request HTTP timeout.')));
    socket.once('error', finish);
    socket.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(new Error('Respons HTTP melebihi batas aman.'));
        return;
      }
      chunks.push(chunk);
    });
    socket.once('end', () => finish());
    socket.once('connect', () => {
      socket.write(Buffer.from(lines.join('\r\n'), 'latin1'));
      if (bodyBuffer.length) socket.write(bodyBuffer);
    });
  });
}

function requestStandard(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url instanceof URL ? url : new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const body = typeof options.body === 'string' ? options.body : '';
    const req = transport.request(parsed, {
      method: String(options.method || 'GET').toUpperCase(),
      headers: {
        ...sanitizeHeaders(options.headers),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > (Number(options.maxBytes) || DEFAULT_MAX_BYTES)) {
          req.destroy(new Error('Respons HTTP melebihi batas aman.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        intercepted: false,
      }));
    });
    req.setTimeout(Number(options.timeoutMs) || 8000, () => req.destroy(new Error('Request HTTP timeout.')));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function safeHttpRequest(url, options = {}) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol === 'http:') return requestRawHttp(parsed, options);
  if (parsed.protocol === 'https:') return requestStandard(parsed, options);
  throw new Error('Protokol HTTP tidak diizinkan.');
}

async function safeJsonRequest(url, options = {}) {
  const response = await safeHttpRequest(url, options);
  let data = null;
  try { data = response.body ? JSON.parse(response.body) : {}; }
  catch { data = response.body; }
  return {
    ok: response.statusCode >= 200 && response.statusCode < 400,
    status: response.statusCode,
    headers: response.headers,
    data,
    intercepted: response.intercepted,
  };
}

module.exports = {
  parseRawHttpResponse,
  safeHttpRequest,
  safeJsonRequest,
  sanitizeHeaders,
};
