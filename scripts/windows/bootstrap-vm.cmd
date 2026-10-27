@echo off
rem Adrt Windows VM bootstrap — double-click (or right-click, Run as
rem administrator) on a fresh VM. Self-elevates and forwards any arguments.
setlocal EnableExtensions

rem Already elevated? net session fails when not admin.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%*'"
  exit /b
)

set "PS1=%~dp0bootstrap-vm.ps1"
if not exist "%PS1%" (
  echo bootstrap-vm.ps1 not found next to this script.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo Bootstrap exited with code %RC%. Review the summary above and the log under C:\adrt\logs.
) else (
  echo Bootstrap finished. The VM is ready to snapshot.
)
echo.
pause
exit /b %RC%
