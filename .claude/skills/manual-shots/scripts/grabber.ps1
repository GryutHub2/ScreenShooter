# Grab a screen rectangle (physical px) every -Ms milliseconds as <Dir>\<elapsed ms>.png until <Dir>\stop exists.
# Used when the app's own recorder cannot be used (e.g. to film the recorder itself). ASCII only.
param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Dir, [int]$Ms = 100, [int]$MaxSec = 120)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Dpi {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static void On() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
    try { SetProcessDPIAware(); } catch (Exception) { }
  }
}
"@
[Dpi]::On()
New-Item -ItemType Directory -Force $Dir | Out-Null
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$next = 0
while (-not (Test-Path (Join-Path $Dir 'stop')) -and $sw.ElapsedMilliseconds -lt ($MaxSec * 1000)) {
  $t = $sw.ElapsedMilliseconds
  $g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Dir ('{0:D7}.png' -f $t)), [System.Drawing.Imaging.ImageFormat]::Png)
  $next += $Ms
  $wait = $next - $sw.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait } else { $next = $sw.ElapsedMilliseconds }
}
$g.Dispose(); $bmp.Dispose()
