# デスクトップとスタートメニューに「スクショ」の起動ショートカットを作る。
# exe を作らず、electron.exe にプロジェクトフォルダを渡す形にしている（ビルド不要・SAC に止められない）。
#
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
#
# 消したいときはショートカットのファイルを削除するだけでよい。

$ErrorActionPreference = 'Stop'

$proj = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $proj 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $proj 'assets\app.ico'

if (-not (Test-Path $exe)) {
  Write-Error "electron.exe がありません: $exe`nプロジェクトフォルダで npm install を実行してください。"
}

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'スクショ.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'スクショ.lnk')
)

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath = $exe
  $sc.Arguments = '"' + $proj + '"'
  $sc.WorkingDirectory = $proj
  $sc.Description = 'スクショ — 範囲を選んで撮り、赤枠や矢印を書き込む'
  if (Test-Path $icon) { $sc.IconLocation = $icon }
  $sc.Save()
  Write-Output "作成: $path"
}

Write-Output ''
Write-Output '起動すると、タスクトレイ（画面右下）に赤いアイコンが常駐します。'
Write-Output 'アイコンを左クリック、または Ctrl+Shift+S で撮影が始まります。'
