const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const UWF_NAMESPACE = 'root\\standardcimv2\\embedded';
const SUPPORTED_EDITION_PATTERN = /(enterprise|education|iot)/i;
const ALLOWED_ACTIONS = new Set(['status', 'freeze', 'unfreeze']);
const DEFAULT_OVERLAY_MB = 4096;
const FARONICS_PROVIDER = 'faronics';
const UWF_PROVIDER = 'uwf';

const STATUS_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$ErrorActionPreference = 'Stop'",
  "$productName = ''",
  "try { $productName = [string](Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').ProductName } catch {}",
  "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
  "$principal = New-Object Security.Principal.WindowsPrincipal($identity)",
  "$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
  "$systemDrive = [string]$env:SystemDrive",
  "$uwfPath = Join-Path $env:SystemRoot 'System32\\uwfmgr.exe'",
  "$result = [ordered]@{",
  "  product_name = $productName",
  "  supported = [bool]($productName -match '(?i)Enterprise|Education|IoT')",
  "  is_admin = [bool]$isAdmin",
  "  system_drive = $systemDrive",
  "  feature_installed = [bool](Test-Path $uwfPath)",
  "  provider_ready = $false",
  "  current_enabled = $false",
  "  next_enabled = $false",
  "  current_protected = $false",
  "  next_protected = $false",
  "  overlay_consumption_mb = 0",
  "  overlay_available_mb = 0",
  "  error = ''",
  "}",
  "if ($result.feature_installed) {",
  "  try {",
  "    $filter = Get-CimInstance -Namespace '" + UWF_NAMESPACE + "' -ClassName UWF_Filter -ErrorAction Stop | Select-Object -First 1",
  "    $volumes = @(Get-CimInstance -Namespace '" + UWF_NAMESPACE + "' -ClassName UWF_Volume -ErrorAction Stop)",
  "    $currentVolume = $volumes | Where-Object { $_.DriveLetter -eq $systemDrive -and $_.CurrentSession -eq $true } | Select-Object -First 1",
  "    $nextVolume = $volumes | Where-Object { $_.DriveLetter -eq $systemDrive -and $_.CurrentSession -eq $false } | Select-Object -First 1",
  "    $result.current_enabled = [bool]$filter.CurrentEnabled",
  "    $result.next_enabled = [bool]$filter.NextEnabled",
  "    $result.current_protected = [bool]($currentVolume -and $currentVolume.Protected)",
  "    $result.next_protected = [bool]($nextVolume -and $nextVolume.Protected)",
  "    try {",
  "      $overlay = Get-CimInstance -Namespace '" + UWF_NAMESPACE + "' -ClassName UWF_Overlay -ErrorAction Stop | Select-Object -First 1",
  "      $result.overlay_consumption_mb = [uint32]$overlay.OverlayConsumption",
  "      $result.overlay_available_mb = [uint32]$overlay.AvailableSpace",
  "    } catch {}",
  "    $result.provider_ready = $true",
  "  } catch {",
  "    $result.error = [string]$_.Exception.Message",
  "  }",
  "}",
  "$result | ConvertTo-Json -Compress -Depth 3",
].join('\r\n');

function runProcess(file, args, options = {}) {
  return new Promise((resolve) => {
    const finish = (error, stdout = '', stderr = '') => {
      const numericCode = typeof error?.code === 'number'
        ? error.code
        : (error ? -1 : 0);
      resolve({
        ok: !error,
        code: numericCode,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? String(error.message || error) : '',
      });
    };

    try {
      execFile(file, args, {
        windowsHide: true,
        timeout: options.timeout || 60_000,
        maxBuffer: options.maxBuffer || 1024 * 1024,
      }, finish);
    } catch (error) {
      finish(error);
    }
  });
}

function parseStatusOutput(output) {
  const line = String(output || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('{') && value.endsWith('}'));
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isEditionSupported(productName) {
  return SUPPORTED_EDITION_PATTERN.test(String(productName || ''));
}

function statusMessage(state) {
  const messages = {
    unsupported_platform: 'Deep Freeze hanya tersedia pada client Windows.',
    unsupported_edition: 'Edisi Windows ini tidak mendukung Unified Write Filter (perlu Enterprise, Education, atau IoT Enterprise).',
    provider_not_installed: 'Windows Home/Pro memerlukan Faronics Deep Freeze Enterprise. Instal workstation berlisensi agar LabKom dapat mengelolanya.',
    provider_auth_required: 'Masukkan password Command Line Faronics sekali pada PC siswa sebelum kontrol jarak jauh digunakan.',
    feature_not_installed: 'Unified Write Filter belum terpasang. Perintah bekukan akan memasangnya dan memerlukan restart.',
    feature_pending_restart: 'Unified Write Filter sudah dipasang dan menunggu restart Windows.',
    frozen: 'Mode beku aktif. Perubahan pada drive sistem akan dibuang saat restart.',
    open: 'Mode terbuka. Perubahan pada drive sistem akan disimpan.',
    pending_freeze: 'Mode beku dijadwalkan dan akan aktif setelah restart.',
    pending_unfreeze: 'Mode terbuka dijadwalkan dan akan aktif setelah restart.',
    partial: 'Konfigurasi UWF belum lengkap. Kirim ulang perintah mode yang diinginkan.',
    configuring: 'Konfigurasi Deep Freeze sedang diproses.',
    error: 'Status perlindungan drive tidak dapat dibaca.',
  };
  return messages[state] || messages.error;
}

function normalizeDeepFreezeStatus(raw = {}, options = {}) {
  if (options.platform && options.platform !== 'win32') {
    return {
      success: true,
      state: 'unsupported_platform',
      provider: 'none',
      provider_label: 'Tidak tersedia',
      supported: false,
      feature_installed: false,
      provider_ready: false,
      is_admin: false,
      can_configure: false,
      current_enabled: false,
      next_enabled: false,
      current_protected: false,
      next_protected: false,
      current_frozen: false,
      next_frozen: false,
      restart_required: false,
      overlay_consumption_mb: 0,
      overlay_available_mb: 0,
      product_name: '',
      system_drive: '',
      message: statusMessage('unsupported_platform'),
      observed_at: Date.now(),
    };
  }

  const productName = String(raw.product_name || '');
  const supported = raw.supported === true || isEditionSupported(productName);
  const featureInstalled = raw.feature_installed === true;
  const providerReady = raw.provider_ready === true;
  const currentEnabled = raw.current_enabled === true;
  const nextEnabled = raw.next_enabled === true;
  const currentProtected = raw.current_protected === true;
  const nextProtected = raw.next_protected === true;
  const currentFrozen = currentEnabled && currentProtected;
  const nextFrozen = nextEnabled && nextProtected;

  let state = 'open';
  if (!supported) state = 'unsupported_edition';
  else if (!featureInstalled) state = 'feature_not_installed';
  else if (!providerReady) state = 'feature_pending_restart';
  else if (currentFrozen && nextFrozen) state = 'frozen';
  else if (!currentFrozen && nextFrozen) state = 'pending_freeze';
  else if (currentFrozen && !nextFrozen) state = 'pending_unfreeze';
  else if (currentEnabled || nextEnabled || currentProtected || nextProtected) state = 'partial';

  return {
    success: true,
    state,
    provider: UWF_PROVIDER,
    provider_label: 'Microsoft Unified Write Filter',
    credential_configured: true,
    requires_provider_password: false,
    supported,
    feature_installed: featureInstalled,
    provider_ready: providerReady,
    is_admin: raw.is_admin === true,
    can_configure: supported && featureInstalled && providerReady && raw.is_admin === true,
    current_enabled: currentEnabled,
    next_enabled: nextEnabled,
    current_protected: currentProtected,
    next_protected: nextProtected,
    current_frozen: currentFrozen,
    next_frozen: nextFrozen,
    restart_required: currentEnabled !== nextEnabled || currentProtected !== nextProtected || state === 'feature_pending_restart',
    overlay_consumption_mb: Math.max(0, Number(raw.overlay_consumption_mb) || 0),
    overlay_available_mb: Math.max(0, Number(raw.overlay_available_mb) || 0),
    product_name: productName.slice(0, 160),
    system_drive: /^[A-Za-z]:$/.test(String(raw.system_drive || '')) ? String(raw.system_drive).toUpperCase() : 'C:',
    technical_error: String(raw.error || '').slice(0, 500),
    message: statusMessage(state),
    observed_at: Date.now(),
  };
}

function createDeepFreezeManager(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const run = options.run || runProcess;
  const logger = options.logger || console;
  const userDataPath = path.resolve(options.userDataPath || process.cwd());
  const executablePath = path.resolve(options.executablePath || process.execPath);
  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows');
  const system32 = path.join(systemRoot, 'System32');
  const powershellPath = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const uwfPath = path.join(system32, 'uwfmgr.exe');
  const dismPath = path.join(system32, 'dism.exe');
  const pendingPath = path.join(userDataPath, 'deep-freeze.pending.json');
  const getProviderPassword = typeof options.getProviderPassword === 'function'
    ? options.getProviderPassword
    : () => '';
  const setProviderPassword = typeof options.setProviderPassword === 'function'
    ? options.setProviderPassword
    : () => {};
  const dfcCandidates = [
    path.join(systemRoot, 'SysWOW64', 'DFC.exe'),
    path.join(systemRoot, 'System32', 'DFC.exe'),
    path.join(String(env.ProgramFiles || 'C:\\Program Files'), 'Faronics', 'Deep Freeze Enterprise', 'DFC.exe'),
    path.join(String(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'), 'Faronics', 'Deep Freeze Enterprise', 'DFC.exe'),
  ];

  function clearPending() {
    try {
      if (fsImpl.existsSync(pendingPath)) fsImpl.unlinkSync(pendingPath);
    } catch (error) {
      logger.warn?.('[DEEP-FREEZE] Gagal menghapus status pending:', error.message);
    }
  }

  function savePending(action, provider = UWF_PROVIDER) {
    try {
      fsImpl.mkdirSync(userDataPath, { recursive: true });
      fsImpl.writeFileSync(pendingPath, JSON.stringify({
        action,
        provider,
        requested_at: Date.now(),
      }, null, 2), 'utf8');
    } catch (error) {
      logger.warn?.('[DEEP-FREEZE] Gagal menyimpan status pending:', error.message);
    }
  }

  function loadPending() {
    try {
      const value = JSON.parse(fsImpl.readFileSync(pendingPath, 'utf8'));
      if (!['freeze', 'unfreeze'].includes(value?.action)) return null;
      return {
        ...value,
        provider: value.provider === FARONICS_PROVIDER ? FARONICS_PROVIDER : UWF_PROVIDER,
      };
    } catch {
      return null;
    }
  }

  function findDfcPath() {
    return dfcCandidates.find((candidate) => {
      try { return fsImpl.existsSync(candidate); } catch { return false; }
    }) || null;
  }

  async function getFaronicsStatus(parsed, dfcPath) {
    const probe = await run(dfcPath, ['get', '/ISFROZEN'], { timeout: 30_000 });
    const credentialConfigured = Boolean(String(getProviderPassword() || '').trim());
    if (![0, 1].includes(probe.code)) {
      return {
        success: false,
        state: 'error',
        provider: FARONICS_PROVIDER,
        provider_label: 'Faronics Deep Freeze Enterprise',
        supported: true,
        feature_installed: true,
        provider_ready: false,
        is_admin: parsed.is_admin === true,
        can_configure: false,
        credential_configured: credentialConfigured,
        requires_provider_password: !credentialConfigured,
        current_enabled: false,
        next_enabled: false,
        current_protected: false,
        next_protected: false,
        current_frozen: false,
        next_frozen: false,
        restart_required: false,
        overlay_consumption_mb: 0,
        overlay_available_mb: 0,
        product_name: String(parsed.product_name || '').slice(0, 160),
        system_drive: String(parsed.system_drive || 'C:').toUpperCase(),
        dfc_path: dfcPath,
        message: 'Faronics DFC ditemukan tetapi status Frozen tidak dapat dibaca.',
        technical_error: String(probe.stderr || probe.stdout || probe.error || '').slice(0, 500),
        observed_at: Date.now(),
      };
    }

    const currentFrozen = probe.code === 1;
    let pending = loadPending();
    if (pending?.provider === FARONICS_PROVIDER) {
      const requestedFrozen = pending.action === 'freeze';
      if (requestedFrozen === currentFrozen) {
        clearPending();
        pending = null;
      }
    }
    const providerPending = pending?.provider === FARONICS_PROVIDER ? pending : null;
    const nextFrozen = providerPending ? providerPending.action === 'freeze' : currentFrozen;
    const state = currentFrozen === nextFrozen
      ? (currentFrozen ? 'frozen' : 'open')
      : (nextFrozen ? 'pending_freeze' : 'pending_unfreeze');
    const versionResult = await run(dfcPath, ['get', '/version'], { timeout: 15_000 });
    const version = String(versionResult.stdout || '').trim().split(/\r?\n/).pop()?.slice(0, 120) || '';

    return {
      success: true,
      state,
      provider: FARONICS_PROVIDER,
      provider_label: 'Faronics Deep Freeze Enterprise',
      supported: true,
      feature_installed: true,
      provider_ready: true,
      is_admin: parsed.is_admin === true,
      can_configure: credentialConfigured,
      credential_configured: credentialConfigured,
      requires_provider_password: !credentialConfigured,
      current_enabled: currentFrozen,
      next_enabled: nextFrozen,
      current_protected: currentFrozen,
      next_protected: nextFrozen,
      current_frozen: currentFrozen,
      next_frozen: nextFrozen,
      restart_required: currentFrozen !== nextFrozen,
      overlay_consumption_mb: 0,
      overlay_available_mb: 0,
      product_name: String(parsed.product_name || '').slice(0, 160),
      system_drive: /^[A-Za-z]:$/.test(String(parsed.system_drive || ''))
        ? String(parsed.system_drive).toUpperCase()
        : 'C:',
      faronics_version: version,
      dfc_path: dfcPath,
      technical_error: '',
      message: state === 'frozen'
        ? 'Faronics Deep Freeze aktif. Perubahan siswa akan dibuang saat restart.'
        : state === 'open'
          ? 'Faronics Deep Freeze dalam mode Thawed. Perubahan akan disimpan.'
          : statusMessage(state),
      observed_at: Date.now(),
    };
  }

  async function getStatus() {
    if (platform !== 'win32') return normalizeDeepFreezeStatus({}, { platform });

    const result = await run(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-Command', STATUS_SCRIPT,
    ], { timeout: 30_000 });

    const parsed = parseStatusOutput(result.stdout);
    if (!parsed) {
      return {
        ...normalizeDeepFreezeStatus({
          product_name: '',
          supported: false,
          error: result.stderr || result.error || 'PowerShell tidak menghasilkan status.',
        }, { platform }),
        success: false,
        state: 'error',
        message: statusMessage('error'),
      };
    }

    const dfcPath = findDfcPath();
    if (dfcPath) return getFaronicsStatus(parsed, dfcPath);

    const uwfStatus = normalizeDeepFreezeStatus(parsed, { platform });
    if (!uwfStatus.supported) {
      return {
        ...uwfStatus,
        provider: 'none',
        provider_label: 'Belum terpasang',
        state: 'provider_not_installed',
        message: statusMessage('provider_not_installed'),
      };
    }
    return uwfStatus;
  }

  async function runUwf(args, timeout = 90_000) {
    const result = await run(uwfPath, args, { timeout });
    return {
      ...result,
      ok: result.code === 0,
      summary: String(result.stderr || result.stdout || result.error || '').trim().slice(0, 600),
    };
  }

  function getExclusions(systemDrive) {
    const drive = String(systemDrive || 'C:').toUpperCase();
    const candidates = [userDataPath, path.dirname(executablePath)];
    return [...new Set(candidates)]
      .filter((candidate) => fsImpl.existsSync(candidate))
      .filter((candidate) => candidate.toUpperCase().startsWith(drive + path.sep))
      .filter((candidate) => path.parse(candidate).root.toUpperCase() !== candidate.toUpperCase())
      .slice(0, 4);
  }

  async function installFeature() {
    return run(dismPath, [
      '/Online',
      '/Enable-Feature',
      '/FeatureName:Client-UnifiedWriteFilter',
      '/All',
      '/NoRestart',
    ], { timeout: 15 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  }

  async function configureFaronics(action, status, configureOptions = {}) {
    if (action === 'freeze' && status.current_frozen && status.next_frozen) {
      clearPending();
      return { ...status, success: true, message: 'Faronics sudah dalam mode Frozen.' };
    }
    if (action === 'unfreeze' && !status.current_frozen && !status.next_frozen) {
      clearPending();
      return { ...status, success: true, message: 'Faronics sudah dalam mode Thawed.' };
    }

    const suppliedPassword = String(configureOptions.providerPassword || '').slice(0, 63);
    const storedPassword = String(getProviderPassword() || '').slice(0, 63);
    const password = suppliedPassword || storedPassword;
    if (!password.trim()) {
      return {
        ...status,
        success: false,
        state: 'provider_auth_required',
        can_configure: false,
        credential_configured: false,
        requires_provider_password: true,
        message: statusMessage('provider_auth_required'),
      };
    }
    if (password.length > 63) {
      return {
        ...status,
        success: false,
        state: 'provider_auth_required',
        requires_provider_password: true,
        message: 'Password Command Line Faronics maksimal 63 karakter.',
      };
    }

    const command = action === 'freeze' ? '/FREEZENEXTBOOT' : '/THAWNEXTBOOT';
    const result = await run(status.dfc_path, [password, command], { timeout: 90_000 });
    if (result.code !== 0) {
      return {
        ...status,
        success: false,
        state: 'provider_auth_required',
        can_configure: false,
        requires_provider_password: true,
        message: 'Perintah Faronics ditolak. Periksa password Command Line dan hak DFC.',
        technical_error: String(result.stderr || result.stdout || result.error || '').slice(0, 500),
      };
    }

    if (suppliedPassword) {
      try { setProviderPassword(suppliedPassword); } catch (error) {
        logger.warn?.('[DEEP-FREEZE] Password Faronics tidak dapat disimpan:', error.message);
      }
    }
    savePending(action, FARONICS_PROVIDER);
    const nextFrozen = action === 'freeze';
    return {
      ...status,
      success: true,
      state: nextFrozen ? 'pending_freeze' : 'pending_unfreeze',
      can_configure: true,
      credential_configured: true,
      requires_provider_password: false,
      next_enabled: nextFrozen,
      next_protected: nextFrozen,
      next_frozen: nextFrozen,
      restart_required: status.current_frozen !== nextFrozen,
      message: nextFrozen
        ? 'Faronics dijadwalkan Frozen pada restart berikutnya.'
        : 'Faronics dijadwalkan Thawed pada restart berikutnya.',
    };
  }

  async function configure(action, configureOptions = {}) {
    if (!ALLOWED_ACTIONS.has(action)) {
      return { success: false, state: 'error', message: 'Aksi Deep Freeze tidak valid.', observed_at: Date.now() };
    }
    if (action === 'status') return getStatus();

    let status = await getStatus();
    if (!status.supported) {
      return { ...status, success: false };
    }
    if (status.provider === FARONICS_PROVIDER) {
      return configureFaronics(action, status, configureOptions);
    }
    if (!status.is_admin) {
      return {
        ...status,
        success: false,
        requires_admin: true,
        message: 'Client LabKom harus berjalan sebagai Administrator untuk mengubah Unified Write Filter.',
      };
    }

    if (action === 'unfreeze' && !status.feature_installed) {
      clearPending();
      return { ...status, success: true, state: 'open', message: statusMessage('open') };
    }

    if (action === 'freeze' && !status.feature_installed) {
      savePending('freeze');
      const installResult = await installFeature();
      if (![0, 3010].includes(installResult.code)) {
        return {
          ...status,
          success: false,
          state: 'error',
          message: 'Pemasangan Unified Write Filter gagal.',
          technical_error: String(installResult.stderr || installResult.error || installResult.stdout).slice(0, 600),
        };
      }
      status = await getStatus();
      if (!status.feature_installed || !status.provider_ready) {
        return {
          ...status,
          success: true,
          state: 'feature_pending_restart',
          restart_required: true,
          pending_action: 'freeze',
          message: 'Unified Write Filter berhasil dipasang. Restart PC diperlukan; LabKom akan melanjutkan mode beku setelah restart.',
        };
      }
    }

    if (!status.provider_ready) {
      if (action === 'freeze') savePending('freeze');
      else clearPending();
      return {
        ...status,
        success: action === 'unfreeze',
        restart_required: true,
        pending_action: action === 'freeze' ? 'freeze' : null,
      };
    }

    if (action === 'freeze') {
      if (status.current_frozen && status.next_frozen) {
        clearPending();
        return { ...status, success: true, message: 'Mode beku sudah aktif.' };
      }

      const drive = status.system_drive || 'C:';
      const protectResult = await runUwf(['volume', 'protect', drive]);
      if (!protectResult.ok) {
        return { ...status, success: false, state: 'error', message: 'Drive sistem gagal dijadwalkan untuk perlindungan UWF.', technical_error: protectResult.summary };
      }

      const warnings = [];
      for (const exclusion of getExclusions(drive)) {
        const result = await runUwf(['file', 'add-exclusion', exclusion]);
        if (!result.ok && !/already|sudah/i.test(result.summary)) warnings.push('Pengecualian LabKom gagal: ' + exclusion);
      }

      const overlayCommands = [
        ['overlay', 'set-type', 'disk'],
        ['overlay', 'set-size', String(DEFAULT_OVERLAY_MB)],
        ['overlay', 'set-warningthreshold', '3072'],
        ['overlay', 'set-criticalthreshold', '3584'],
        ['overlay', 'set-persistent', 'off'],
      ];
      for (const args of overlayCommands) {
        const result = await runUwf(args);
        if (!result.ok) warnings.push('Pengaturan ' + args.slice(0, 2).join(' ') + ' gagal.');
      }

      const enableResult = await runUwf(['filter', 'enable']);
      if (!enableResult.ok) {
        return { ...status, success: false, state: 'error', message: 'Unified Write Filter gagal diaktifkan.', technical_error: enableResult.summary, warnings };
      }

      clearPending();
      const updated = await getStatus();
      return {
        ...updated,
        success: true,
        state: updated.current_frozen ? 'frozen' : 'pending_freeze',
        next_enabled: true,
        next_protected: true,
        next_frozen: true,
        restart_required: !updated.current_frozen,
        warnings,
        message: updated.current_frozen
          ? 'Mode beku aktif.'
          : 'Mode beku dijadwalkan. Restart PC untuk mulai membuang perubahan siswa.',
      };
    }

    clearPending();
    const disableResult = await runUwf(['filter', 'disable']);
    if (!disableResult.ok) {
      return { ...status, success: false, state: 'error', message: 'Unified Write Filter gagal dinonaktifkan.', technical_error: disableResult.summary };
    }
    const unprotectResult = await runUwf(['volume', 'unprotect', status.system_drive || 'C:']);
    const updated = await getStatus();
    return {
      ...updated,
      success: true,
      state: updated.current_frozen ? 'pending_unfreeze' : 'open',
      next_enabled: false,
      next_protected: false,
      next_frozen: false,
      restart_required: updated.current_frozen || updated.current_enabled,
      warnings: unprotectResult.ok ? [] : ['Status perlindungan volume belum dapat dibersihkan.'],
      message: updated.current_frozen
        ? 'Mode terbuka dijadwalkan. Restart diperlukan; perubahan pada sesi beku saat ini tetap akan dibuang.'
        : 'Mode terbuka aktif. Perubahan berikutnya akan disimpan.',
    };
  }

  async function reconcilePending() {
    const pending = loadPending();
    if (!pending) return getStatus();
    const status = await getStatus();
    if (pending.provider === FARONICS_PROVIDER) return status;
    if (!status.is_admin || !status.feature_installed || !status.provider_ready) {
      return { ...status, pending_action: 'freeze' };
    }
    return configure('freeze');
  }

  async function safePowerAction(action) {
    if (platform !== 'win32' || !['restart', 'shutdown'].includes(action)) return false;
    const status = await getStatus();
    if (status.provider !== UWF_PROVIDER) return false;
    const result = await runUwf(['filter', action], 120_000);
    return result.ok;
  }

  return {
    getStatus,
    configure,
    reconcilePending,
    safePowerAction,
    paths: { uwfPath, dismPath, powershellPath, pendingPath, dfcCandidates },
  };
}

module.exports = {
  ALLOWED_ACTIONS,
  DEFAULT_OVERLAY_MB,
  FARONICS_PROVIDER,
  UWF_PROVIDER,
  STATUS_SCRIPT,
  createDeepFreezeManager,
  isEditionSupported,
  normalizeDeepFreezeStatus,
  parseStatusOutput,
  runProcess,
};
