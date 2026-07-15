!include "LogicLib.nsh"

!macro customInstall
  ; Fresh per-machine installs already run elevated, so use that Windows
  ; credential once to provision the optional UWF component. Updates remain
  ; fast and existing installations can provision UWF from the Student UI.
  ${ifNot} ${isUpdated}
    DetailPrint "Menyiapkan komponen perlindungan PC (Unified Write Filter)..."
    File /oname=$PLUGINSDIR\provisionUwf.ps1 "${BUILD_RESOURCES_DIR}\provisionUwf.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\provisionUwf.ps1"'
    Pop $0
    DetailPrint "Provisioning Unified Write Filter selesai (kode $0)."
  ${endIf}
!macroend
