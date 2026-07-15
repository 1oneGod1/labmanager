[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$programData = [Environment]::GetFolderPath('CommonApplicationData')
$stateDirectory = Join-Path $programData 'LabKom'
$statePath = Join-Path $stateDirectory 'uwf-provision.json'
$logPath = Join-Path $stateDirectory 'uwf-provision.log'

function Write-ProvisionLog {
  param([string]$Message)
  try {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $line = '{0} {1}' -f [DateTimeOffset]::UtcNow.ToString('o'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  } catch {
    Write-Output ('Log provisioning tidak dapat ditulis: ' + $_.Exception.Message)
  }
}

function Save-ProvisionState {
  param(
    [string]$State,
    [bool]$Success,
    [bool]$Supported,
    [bool]$IsAdmin,
    [bool]$RestartRequired,
    [int]$ExitCode,
    [string]$Message,
    [string]$ProductName
  )

  $record = [ordered]@{
    schema_version = 1
    state = $State
    success = $Success
    supported = $Supported
    installer_elevated = $IsAdmin
    credentials_stored = $false
    restart_required = $RestartRequired
    exit_code = $ExitCode
    product_name = $ProductName
    message = $Message
    observed_at = [DateTimeOffset]::UtcNow.ToString('o')
  }

  try {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $record | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $statePath -Encoding UTF8
  } catch {
    Write-Output ('Status provisioning tidak dapat ditulis: ' + $_.Exception.Message)
  }
  Write-ProvisionLog ($State + ': ' + $Message)
}

try {
  $productName = ''
  try {
    $productName = [string](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').ProductName
  } catch {
    $productName = 'Windows'
  }

  $supported = $productName -match '(?i)Enterprise|Education|IoT'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

  # Jika workstation Faronics Enterprise sudah tersedia, LabKom memakai DFC
  # dan tidak perlu mengaktifkan optional feature UWF.
  $dfcCandidates = @(
    (Join-Path $env:SystemRoot 'SysWOW64\DFC.exe'),
    (Join-Path $env:SystemRoot 'System32\DFC.exe'),
    (Join-Path $env:ProgramFiles 'Faronics\Deep Freeze Enterprise\DFC.exe')
  )
  if (${env:ProgramFiles(x86)}) {
    $dfcCandidates += Join-Path ${env:ProgramFiles(x86)} 'Faronics\Deep Freeze Enterprise\DFC.exe'
  }
  $dfcPath = $dfcCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($dfcPath) {
    $state = @{
      State = 'faronics_ready'
      Success = $true
      Supported = $true
      IsAdmin = $isAdmin
      RestartRequired = $false
      ExitCode = 0
      ProductName = $productName
      Message = 'Faronics Deep Freeze Enterprise terdeteksi. Masukkan password Command Line satu kali dari Pengaturan LabKom Siswa.'
    }
    Save-ProvisionState @state
    exit 0
  }

  if (-not $supported) {
    $state = @{
      State = 'unsupported_edition'
      Success = $false
      Supported = $false
      IsAdmin = $isAdmin
      RestartRequired = $false
      ExitCode = 0
      ProductName = $productName
      Message = 'Edisi Windows tidak menyediakan UWF. Instal Faronics Deep Freeze Enterprise berlisensi agar proteksi restart dapat dikelola LabKom.'
    }
    Save-ProvisionState @state
    exit 0
  }

  if (-not $isAdmin) {
    $state = @{
      State = 'requires_admin'
      Success = $false
      Supported = $true
      IsAdmin = $false
      RestartRequired = $false
      ExitCode = 0
      ProductName = $productName
      Message = 'Installer tidak menerima izin Administrator Windows. UWF dapat dipasang ulang dari menu Pengaturan Siswa.'
    }
    Save-ProvisionState @state
    exit 0
  }

  $nativeSystem = Join-Path $env:SystemRoot 'System32'
  $sysnative = Join-Path $env:SystemRoot 'Sysnative'
  if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess -and (Test-Path $sysnative)) {
    $nativeSystem = $sysnative
  }

  $uwfManager = Join-Path $nativeSystem 'uwfmgr.exe'
  if (Test-Path $uwfManager) {
    $state = @{
      State = 'already_installed'
      Success = $true
      Supported = $true
      IsAdmin = $true
      RestartRequired = $false
      ExitCode = 0
      ProductName = $productName
      Message = 'Unified Write Filter sudah tersedia. Aktivasi perlindungan tetap dilakukan dari aplikasi dengan izin Kepala Lab.'
    }
    Save-ProvisionState @state
    exit 0
  }

  $dism = Join-Path $nativeSystem 'dism.exe'
  if (-not (Test-Path $dism)) {
    throw 'DISM Windows tidak ditemukan.'
  }

  Write-ProvisionLog 'Memasang optional feature Client-UnifiedWriteFilter.'
  $arguments = @(
    '/Online',
    '/Enable-Feature',
    '/FeatureName:Client-UnifiedWriteFilter',
    '/All',
    '/NoRestart',
    '/Quiet'
  )
  $process = Start-Process -FilePath $dism -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  $exitCode = [int]$process.ExitCode
  if ($exitCode -ne 0 -and $exitCode -ne 3010) {
    $state = @{
      State = 'failed'; Success = $false; Supported = $true; IsAdmin = $true
      RestartRequired = $false; ExitCode = $exitCode; ProductName = $productName
      Message = ('Windows gagal memasang Unified Write Filter. Kode DISM: ' + $exitCode)
    }
    Save-ProvisionState @state
    exit 0
  }

  $restartRequired = $exitCode -eq 3010 -or -not (Test-Path $uwfManager)
  $message = if ($restartRequired) {
    'Unified Write Filter berhasil dipasang dan memerlukan restart sebelum dapat diaktifkan.'
  } else {
    'Unified Write Filter berhasil dipasang. Aktivasi perlindungan menunggu izin Kepala Lab.'
  }
  $state = @{
    State = $(if ($restartRequired) { 'restart_required' } else { 'installed' })
    Success = $true; Supported = $true; IsAdmin = $true
    RestartRequired = $restartRequired; ExitCode = $exitCode; ProductName = $productName
    Message = $message
  }
  Save-ProvisionState @state
} catch {
  $state = @{
    State = 'error'; Success = $false; Supported = $true; IsAdmin = $true
    RestartRequired = $false; ExitCode = -1; ProductName = $productName
    Message = ('Provisioning UWF gagal: ' + $_.Exception.Message)
  }
  Save-ProvisionState @state
}

# Provisioning tidak boleh menggagalkan instalasi aplikasi Siswa. Kesalahan
# tetap tercatat di ProgramData dan dapat diperbaiki melalui UI dengan UAC.
exit 0
