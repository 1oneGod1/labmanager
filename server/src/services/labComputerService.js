const firebaseService = require('./dataService');
const { normalizePcName, normalizeMac } = require('./clientRegistryService');

async function getLabComputers() {
  const rows = await firebaseService.computers.getAll();
  return rows.map((row) => ({
    ...row,
    pc_name: normalizePcName(row.pc_name),
    bound_hostname: normalizePcName(row.bound_hostname) || null,
    bound_mac: normalizeMac(row.bound_mac) || null,
  }));
}

async function getLabComputerByPcName(pcName) {
  const normalizedPcName = normalizePcName(pcName);
  if (!normalizedPcName) return null;

  const row = await firebaseService.computers.getByPcName(normalizedPcName);
  if (!row) return null;

  return {
    ...row,
    pc_name: normalizePcName(row.pc_name),
    bound_hostname: normalizePcName(row.bound_hostname) || null,
    bound_mac: normalizeMac(row.bound_mac) || null,
  };
}

async function resolveMappedLabPc({ pc_name, mac } = {}) {
  const normalizedPcName = normalizePcName(pc_name);
  const normalizedMac = normalizeMac(mac);

  if (normalizedPcName) {
    const row = await firebaseService.computers.getByBoundHostname(normalizedPcName);
    if (row) {
      return {
        ...row,
        pc_name: normalizePcName(row.pc_name),
        bound_hostname: normalizePcName(row.bound_hostname) || null,
        bound_mac: normalizeMac(row.bound_mac) || null,
      };
    }
  }

  if (normalizedMac) {
    const row = await firebaseService.computers.getByBoundMac(normalizedMac);
    if (row) {
      return {
        ...row,
        pc_name: normalizePcName(row.pc_name),
        bound_hostname: normalizePcName(row.bound_hostname) || null,
        bound_mac: normalizeMac(row.bound_mac) || null,
      };
    }
  }

  return null;
}

async function assignDeviceToLabComputer({ target_pc_name, source_pc_name, source_mac, source_ip } = {}) {
  const targetPcName = normalizePcName(target_pc_name);
  const sourcePcName = normalizePcName(source_pc_name);
  const sourceMac = normalizeMac(source_mac);
  const sourceIp = String(source_ip || '').trim() || null;

  if (!targetPcName) {
    throw new Error('target_pc_name wajib diisi.');
  }
  if (!sourcePcName && !sourceMac) {
    throw new Error('source_pc_name atau source_mac wajib diisi.');
  }

  const row = await firebaseService.computers.assignDevice({
    targetPcName,
    sourcePcName,
    sourceMac,
    sourceIp,
  });

  return row;
}

async function clearDeviceMapping(target_pc_name) {
  const targetPcName = normalizePcName(target_pc_name);
  if (!targetPcName) {
    throw new Error('target_pc_name wajib diisi.');
  }

  return firebaseService.computers.clearMapping(targetPcName);
}

module.exports = {
  getLabComputers,
  getLabComputerByPcName,
  resolveMappedLabPc,
  assignDeviceToLabComputer,
  clearDeviceMapping,
};
