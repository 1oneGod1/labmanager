const assert = require('node:assert/strict');
const { verifyEmergencyPassword } = require('../electron/emergencyPassword');

assert.equal(verifyEmergencyPassword('labkom123', ''), true);
assert.equal(verifyEmergencyPassword('Labkom123', ''), false);
assert.equal(verifyEmergencyPassword('password-salah', ''), false);
assert.equal(verifyEmergencyPassword('', ''), false);

// Password dapat diganti untuk deployment khusus melalui environment variable.
assert.equal(verifyEmergencyPassword('khusus-lab', 'khusus-lab'), true);
assert.equal(verifyEmergencyPassword('labkom123', 'khusus-lab'), false);

console.log('Emergency exit password verification passed.');
