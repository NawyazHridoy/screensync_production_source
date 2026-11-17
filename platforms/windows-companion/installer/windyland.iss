; ScreenSync installer (Inno Setup 6). Built by build.ps1:
;   ISCC.exe /DAppVersion=0.1.0 /DOutDir=<folder> installer\screensync-island.iss

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef OutDir
  #define OutDir "..\dist"
#endif

[Setup]
AppId={{B064C2A6-7D1A-453A-AF15-9B046EEAE6A1}
AppName=ScreenSync
AppVersion={#AppVersion}
AppVerName=ScreenSync {#AppVersion}
AppPublisher=Shabab
AppPublisherURL=https://github.com/screensync/MultiPurposeIsland
AppSupportURL=https://github.com/screensync/MultiPurposeIsland/issues
AppUpdatesURL=https://github.com/screensync/MultiPurposeIsland/releases
AppCopyright=Copyright (C) 2026 Shabab
AppMutex=ScreenSync.SingleInstance
CloseApplications=yes
DefaultDirName={autopf}\ScreenSync
DefaultGroupName=ScreenSync
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=..\LICENSE
SetupIconFile=..\assets\screensync-island.ico
UninstallDisplayIcon={app}\screensync-island.exe
UninstallDisplayName=ScreenSync
OutputDir={#OutDir}
OutputBaseFilename=ScreenSyncSetup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
InfoBeforeFile=privacy.txt
VersionInfoCompany=Shabab
VersionInfoDescription=ScreenSync Setup
VersionInfoProductName=ScreenSync
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoCopyright=Copyright (C) 2026 Shabab

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
en.StartupTask=Start ScreenSync when Windows starts
en.RemoveData=Also remove your ScreenSync data (to-do list, water log, shelf, settings)?
en.UpdatesTask=Check for updates automatically (asks GitHub for the latest version about twice a day)

[Tasks]
Name: "startup"; Description: "{cm:StartupTask}"
Name: "desktop"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked
Name: "updates"; Description: "{cm:UpdatesTask}"

[Files]
Source: "..\target\release\screensync-island.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ScreenSync"; ValueData: """{app}\screensync-island.exe"""; Tasks: startup; Flags: uninsdeletevalue

[Icons]
Name: "{autoprograms}\ScreenSync"; Filename: "{app}\screensync-island.exe"
Name: "{autodesktop}\ScreenSync"; Filename: "{app}\screensync-island.exe"; Tasks: desktop

[Run]
Filename: "{app}\screensync-island.exe"; Description: "{cm:LaunchProgram,ScreenSync}"; Flags: postinstall nowait

[UninstallRun]
; Remove the Claude Code / Codex hooks so they don't point at a deleted exe.
Filename: "{app}\screensync-island.exe"; Parameters: "--disconnect-agents"; Flags: runhidden waituntilterminated; RunOnceId: "DisconnectAgents"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Remember the "Check for updates automatically" choice in ScreenSync's
// settings (a later line wins, so appending is enough).
procedure CurStepChanged(CurStep: TSetupStep);
var
  Dir, Line: String;
begin
  if CurStep = ssPostInstall then
  begin
    Dir := ExpandConstant('{userappdata}\ScreenSync');
    ForceDirectories(Dir);
    if WizardIsTaskSelected('updates') then
      Line := 'update_check=1'
    else
      Line := 'update_check=0';
    SaveStringToFile(Dir + '\settings.txt', #13#10 + Line + #13#10, True);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if DirExists(ExpandConstant('{userappdata}\ScreenSync')) then
      if MsgBox(CustomMessage('RemoveData'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(ExpandConstant('{userappdata}\ScreenSync'), True, True, True);
end;
