# Real mouse / keyboard input for the manual demo. Reads one command per line from stdin.
# Keep this file ASCII only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
#   move X Y MS       smooth move to physical pixel (X,Y) over MS milliseconds
#   click | rclick    left / right click at the current position
#   ldown | lup       press / release the left button (drag = ldown, move, lup)
#   wheel N           wheel by N (120 = one notch up, -120 = one notch down)
#   ctrl|shift down|up  hold / release the modifier
#   key NAME          press one key: esc c v z delete
#   wait MS
#   grab X Y W H FILE save that screen rectangle (physical px) as PNG
#   echo TEXT         print TEXT (the driver uses it to sync captions and ripples)
#   quit
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Inp {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int d, IntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public struct POINT { public int X; public int Y; }
  public static void Dpi() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
    try { SetProcessDPIAware(); } catch (Exception) { }
  }
  // SetCursorPos alone does not update "the window under the cursor", so also inject a real absolute move
  static void Put(int x, int y) {
    SetCursorPos(x, y);
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    if (vw < 2) vw = 2; if (vh < 2) vh = 2;
    mouse_event(0x0001 | 0x8000 | 0x4000, (int)((x - vx) * 65535.0 / (vw - 1)), (int)((y - vy) * 65535.0 / (vh - 1)), 0, IntPtr.Zero);
  }
  public static void Move(int x, int y, int ms) {
    POINT p; GetCursorPos(out p);
    int steps = Math.Max(1, ms / 12);
    for (int i = 1; i <= steps; i++) {
      double t = (double)i / steps; t = t * t * (3 - 2 * t);
      Put((int)Math.Round(p.X + (x - p.X) * t), (int)Math.Round(p.Y + (y - p.Y) * t));
      System.Threading.Thread.Sleep(12);
    }
  }
  public static void Btn(uint f) { mouse_event(f, 0, 0, 0, IntPtr.Zero); }
  public static void Click(bool right) {
    Btn(right ? 0x0008u : 0x0002u);
    System.Threading.Thread.Sleep(70);
    Btn(right ? 0x0010u : 0x0004u);
  }
  public static void Wheel(int d) { mouse_event(0x0800, 0, 0, d, IntPtr.Zero); }
  public static void Key(byte vk, bool down) { keybd_event(vk, 0, down ? 0u : 2u, IntPtr.Zero); }
  public static void Tap(byte vk) { Key(vk, true); System.Threading.Thread.Sleep(40); Key(vk, false); }
}
"@
[Inp]::Dpi()
$keys = @{ 'esc' = 0x1B; 'c' = 0x43; 'v' = 0x56; 'z' = 0x5A; 'delete' = 0x2E }
# Whatever happens, never leave a key or the button held down on the real PC
$held = @{ 'l' = $false; 'ctrl' = $false; 'shift' = $false }
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
try {
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim() -split ' '
  switch ($p[0]) {
    'move'   { [Inp]::Move([int]$p[1], [int]$p[2], [int]$p[3]) }
    'click'  { [Inp]::Click($false) }
    'rclick' { [Inp]::Click($true) }
    'ldown'  { [Inp]::Btn(0x0002); $held['l'] = $true }
    'lup'    { [Inp]::Btn(0x0004); $held['l'] = $false }
    'wheel'  { [Inp]::Wheel([int]$p[1]) }
    'ctrl'   { [Inp]::Key(0x11, $p[1] -eq 'down'); $held['ctrl'] = ($p[1] -eq 'down') }
    'shift'  { [Inp]::Key(0x10, $p[1] -eq 'down'); $held['shift'] = ($p[1] -eq 'down') }
    'key'    { [Inp]::Tap([byte]$keys[$p[1]]) }
    'wait'   { Start-Sleep -Milliseconds ([int]$p[1]) }
    'grab'   {
      $bmp = New-Object System.Drawing.Bitmap ([int]$p[3]), ([int]$p[4])
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen([int]$p[1], [int]$p[2], 0, 0, $bmp.Size)
      $bmp.Save(($p[5..($p.Length - 1)] -join ' '), [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
    }
    'echo'   { [Console]::Out.WriteLine(($p[1..($p.Length - 1)] -join ' ')); [Console]::Out.Flush() }
    'quit'   { break }
  }
  if ($p[0] -eq 'quit') { break }
}
} finally {
  if ($held['l']) { [Inp]::Btn(0x0004) }
  if ($held['ctrl']) { [Inp]::Key(0x11, $false) }
  if ($held['shift']) { [Inp]::Key(0x10, $false) }
}
