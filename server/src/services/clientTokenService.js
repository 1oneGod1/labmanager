const crypto = require('crypto');
const dataService = require('./dataService');

const TOKEN_VERSION = 1;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouchedAt = new Map();

function normalizePcName(name) {
  return String(name || '').trim().toUpperCase();
}

function getSigningSecret() {
  const explicit = String(process.env.CLIENT_TOKEN_SECRET || '').trim();
  if (explicit.length >= 32) return explicit;

  // Upgrade-safe fallback: installer lama sudah mempunyai pairing key yang
  // persisten. Derivasi ini menjaga signature stabil sampai secret terpisah
  // dibuat oleh versi Admin terbaru.
  const registrationKey = String(process.env.CLIENT_REGISTRATION_KEY || '').trim();
  if (registrationKey.length >= 32) {
    return crypto.createHash('sha256')
      .update('labkom-device-token\\0' + registrationKey)
      .digest('hex');
  }

  // Hanya untuk development/test. Production selalu memiliki pairing key.
  return 'labkom-development-device-token-secret-change-me';
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', getSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function createToken(claim) {
  const encoded = encodePayload({
    v: TOKEN_VERSION,
    d: claim.device_id,
    p: claim.pc_name,
    j: claim.token_id,
    i: new Date(claim.issued_at).getTime(),
  });
  return `${encoded}.${sign(encoded)}`;
}

function decodeAndVerify(token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) return null;

  const expected = sign(encoded);
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      payload?.v !== TOKEN_VERSION
      || !/^[a-f0-9]{32}$/.test(String(payload.d || ''))
      || !/^[A-Z0-9][A-Z0-9._-]{0,62}$/.test(String(payload.p || ''))
      || !/^[a-f0-9]{32}$/.test(String(payload.j || ''))
      || !Number.isFinite(Number(payload.i))
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueToken({ device_id, pc_name }) {
  const pcKey = normalizePcName(pc_name);
  const normalizedDeviceId = String(device_id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedDeviceId)) {
    return { ok: false, message: 'device_id tidak valid.' };
  }
  if (!/^[A-Z0-9][A-Z0-9._-]{0,62}$/.test(pcKey)) {
    return { ok: false, message: 'pc_name tidak valid.' };
  }

  const existing = dataService.deviceCredentials.getByPcName(pcKey);
  if (existing && existing.device_id !== normalizedDeviceId) {
    return {
      ok: false,
      message: `PC "${pcKey}" sudah diklaim device lain. Hubungi admin untuk reset device.`,
    };
  }

  // Panggilan register yang bersamaan dari renderer dan main process harus
  // menghasilkan token identik agar salah satunya tidak langsung ter-revoke.
  const claim = existing || dataService.deviceCredentials.save({
    pc_name: pcKey,
    device_id: normalizedDeviceId,
    token_id: crypto.randomBytes(16).toString('hex'),
    issued_at: new Date(),
  });
  return { ok: true, token: createToken(claim) };
}

function validateToken(token) {
  const payload = decodeAndVerify(token);
  if (!payload) return null;

  const claim = dataService.deviceCredentials.getByPcName(payload.p);
  if (
    !claim
    || claim.device_id !== payload.d
    || claim.token_id !== payload.j
    || new Date(claim.issued_at).getTime() !== Number(payload.i)
  ) return null;

  const now = Date.now();
  const lastTouch = lastTouchedAt.get(claim.pc_name) || 0;
  if (now - lastTouch >= TOUCH_INTERVAL_MS) {
    lastTouchedAt.set(claim.pc_name, now);
    try { dataService.deviceCredentials.touch(claim.pc_name); } catch {}
  }

  return {
    device_id: claim.device_id,
    pc_name: claim.pc_name,
    expiresAt: null,
  };
}

function revokePcClaim(pc_name) {
  const pcKey = normalizePcName(pc_name);
  lastTouchedAt.delete(pcKey);
  return dataService.deviceCredentials.remove(pcKey);
}

function listClaims() {
  return dataService.deviceCredentials.list().map((claim) => ({
    pc_name: claim.pc_name,
    device_id: claim.device_id,
    expires_at: null,
    issued_at: claim.issued_at || null,
    last_seen_at: claim.last_seen_at || null,
  }));
}

module.exports = {
  TOKEN_VERSION,
  createToken,
  decodeAndVerify,
  issueToken,
  validateToken,
  revokePcClaim,
  listClaims,
};
