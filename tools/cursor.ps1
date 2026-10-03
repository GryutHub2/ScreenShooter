# Returns the current mouse cursor image as JSON: {"hx":..,"hy":..,"w":..,"h":..,"png":"<base64>"}
# hx/hy = hot spot (the pixel the cursor points at) inside the image. Prints {} when there is no visible cursor.
# GDI draws without alpha, so the cursor is drawn on black and on white and the alpha is recovered from the difference.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class CursorShot {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] public struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO info);
  [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int cx, int cy, int step, IntPtr brush, int flags);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  static Bitmap Draw(IntPtr cur, int w, int h, Color bg) {
    var b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(b)) {
      g.Clear(bg);
      IntPtr dc = g.GetHdc();
      DrawIconEx(dc, 0, 0, cur, w, h, 0, IntPtr.Zero, 3);
      g.ReleaseHdc(dc);
    }
    return b;
  }

  public static string Grab() {
    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
    var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (!GetCursorInfo(ref ci) || (ci.flags & 1) == 0 || ci.hCursor == IntPtr.Zero) return "{}";
    ICONINFO ii;
    if (!GetIconInfo(ci.hCursor, out ii)) return "{}";
    int w = 32, h = 32;
    try {
      if (ii.hbmColor != IntPtr.Zero) { using (var c = Image.FromHbitmap(ii.hbmColor)) { w = c.Width; h = c.Height; } }
      else if (ii.hbmMask != IntPtr.Zero) { using (var m = Image.FromHbitmap(ii.hbmMask)) { w = m.Width; h = m.Height / 2; } }
    } finally {
      if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
      if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
    }
    using (var onBlack = Draw(ci.hCursor, w, h, Color.Black))
    using (var onWhite = Draw(ci.hCursor, w, h, Color.White))
    using (var outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        Color k = onBlack.GetPixel(x, y), wh = onWhite.GetPixel(x, y);
        int a = 255 - ((wh.R - k.R) + (wh.G - k.G) + (wh.B - k.B)) / 3;
        if (a < 0) a = 0; if (a > 255) a = 255;
        if (a == 0) { outBmp.SetPixel(x, y, Color.Transparent); continue; }
        Func<int, int> un = v => Math.Min(255, v * 255 / a);
        outBmp.SetPixel(x, y, Color.FromArgb(a, un(k.R), un(k.G), un(k.B)));
      }
      using (var ms = new System.IO.MemoryStream()) {
        outBmp.Save(ms, ImageFormat.Png);
        return "{\"hx\":" + ii.xHotspot + ",\"hy\":" + ii.yHotspot + ",\"w\":" + w + ",\"h\":" + h + ",\"png\":\"" + Convert.ToBase64String(ms.ToArray()) + "\"}";
      }
    }
  }
}
"@
[Console]::Out.WriteLine([CursorShot]::Grab())
