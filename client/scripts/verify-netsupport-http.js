const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseRawHttpResponse,
  sanitizeHeaders,
} = require('../electron/netSupportHttp.cjs');

function interceptedResponse(status, payload) {
  const injectedBody = Buffer.from(
    '<html><head><META HTTP-EQUIV="Refresh" CONTENT="0;URL=http://169.254.90.227:26405/ApprovedWebList.htm"></head></html>\0',
    'utf8',
  );
  const actualBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${injectedBody.length}\r\nConnection: close\r\nContent-Type: text/html\r\n\r\n`, 'latin1'),
    injectedBody,
    Buffer.from(`Content-Length: ${actualBody.length}\r\nX-LabKom-Status: ${status}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n`, 'latin1'),
    actualBody,
  ]);
}

const recovered = parseRawHttpResponse(interceptedResponse(401, {
  success: false,
  message: 'Token perangkat invalid.',
}));
assert.equal(recovered.intercepted, true);
assert.equal(recovered.statusCode, 401);
assert.deepEqual(JSON.parse(recovered.body), {
  success: false,
  message: 'Token perangkat invalid.',
});

const normalBody = Buffer.from(JSON.stringify({ success: true }), 'utf8');
const normal = parseRawHttpResponse(Buffer.concat([
  Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${normalBody.length}\r\nConnection: close\r\n\r\n`, 'latin1'),
  normalBody,
]));
assert.equal(normal.intercepted, false);
assert.equal(normal.statusCode, 200);
assert.deepEqual(JSON.parse(normal.body), { success: true });

const sanitized = sanitizeHeaders({
  Authorization: 'Bearer valid',
  'X-Evil\r\nInjected': 'bad',
  Another: 'bad\r\nHeader: injected',
  Host: 'attacker.invalid',
});
assert.equal(sanitized.Authorization, 'Bearer valid');
assert.equal('Host' in sanitized, false);
assert.equal(Object.keys(sanitized).length, 1);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'src', 'index.js'), 'utf8');
assert.match(mainSource, /safeJsonRequest/);
assert.match(mainSource, /transports: \['websocket'\]/);
assert.doesNotMatch(mainSource, /transports: \['websocket', 'polling'\]/);
assert.match(appSource, /transports: \['websocket'\]/);
assert.match(serverSource, /X-LabKom-Status/);

console.log('NetSupport-safe HTTP recovery and WebSocket-only realtime: PASS');
