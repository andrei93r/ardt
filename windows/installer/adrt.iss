; Adrt — per-user Inno Setup 6 installer.
;
; Build (from the repository root, after scripts/windows/publish.ps1):
;   ISCC.exe windows\installer\adrt.iss
;   ISCC.exe /DAppVersion=0.3.0 windows\installer\adrt.iss
;
; The host payload is read from dist\windows (relative to this script) and the
; setup executable is written to dist\installer. Override either path for a
; one-off build:
;   ISCC.exe /DPayloadDir=C:\build\adrt /DInstallerOutputDir=C:\build\out adrt.iss
;
; The install is per-user and never prompts for elevation:
;   * binaries        %LocalAppData%\Programs\Adrt
;   * Start Menu      %AppData%\Microsoft\Windows\Start Menu\Programs\Adrt
;   * autostart       HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Adrt
;   * user data       %AppData%\Adrt (kept on uninstall, see /PURGEDATA)
;
; Silent use:
;   AdrtSetup-<ver>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
;   AdrtSetup-<ver>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="startup"
;   "%LocalAppData%\Programs\Adrt\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /PURGEDATA

#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif

#ifndef PayloadDir
  #define PayloadDir "..\..\dist\windows"
#endif

#ifndef InstallerOutputDir
  #define InstallerOutputDir "..\..\dist\installer"
#endif

[Setup]
; A stable AppId keeps upgrades and the uninstall entry together.
AppId={{F01C18E9-C568-48E6-BB70-31A92C6C8159}
AppName=Adrt
AppVersion={#AppVersion}
AppVerName=Adrt {#AppVersion}
AppPublisher=Adrt
AppComments=Tile windows into pairs per monitor
DefaultDirName={localappdata}\Programs\Adrt
DefaultGroupName=Adrt
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir={#InstallerOutputDir}
OutputBaseFilename=AdrtSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayName=Adrt
UninstallDisplayIcon={app}\Adrt.Windows.exe
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
AppMutex=Local\Adrt.Windows.SingleInstance
; The host is a console program in the current beta; do not run it elevated.
; A mutex makes a second instance exit with a message instead of tiling twice.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startup"; Description: "Start Adrt when I sign in"; GroupDescription: "Startup:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; publish.ps1 produces a single-file payload. The wildcard keeps any sidecar
; files (for example native DLLs excluded from the bundle) in the install while
; leaving symbols and checksum manifests out.
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "*.pdb,SHA256SUMS.txt,*.sha256"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Adrt"; Filename: "{app}\Adrt.Windows.exe"; WorkingDir: "{app}"; Comment: "Adrt window tiling"; IconFilename: "{app}\Adrt.Windows.exe"
Name: "{group}\Uninstall Adrt"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Adrt"; Filename: "{app}\Adrt.Windows.exe"; WorkingDir: "{app}"; Comment: "Adrt window tiling"; Tasks: desktopicon

[Registry]
; Per-user autostart. Uninstall also removes this explicitly in [Code], so a
; stale entry cannot survive a task-selection change during an upgrade.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Adrt"; ValueData: """{app}\Adrt.Windows.exe"""; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Adrt.Windows.exe"; Description: "Launch Adrt"; Flags: nowait postinstall skipifsilent

[Code]
var
  PurgeDataRequested: Boolean;

function CommandLineHasSwitch(const Switch: String): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
  begin
    if Lowercase(ParamStr(Index)) = Lowercase(Switch) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  PurgeDataRequested :=
    CommandLineHasSwitch('/PURGEDATA') or CommandLineHasSwitch('-PURGEDATA');
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Remove the autostart value even when the install task was changed later.
    if RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Adrt') then
    begin
    end;
  end;

  if (CurUninstallStep = usPostUninstall) and PurgeDataRequested then
  begin
    // Only the per-user data directory, never the install directory.
    DataDir := ExpandConstant('{userappdata}\Adrt');
    if DirExists(DataDir) then
    begin
      DelTree(DataDir, True, True, True);
    end;
  end;
end;
