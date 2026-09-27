# いま画面に出ているウィンドウと、その中の部品の位置を JSON で1行返す。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\win-rects.ps1 -SkipPid 1234
#
# -Serve を付けると常駐し、標準入力に1行来るたびに1行返す（毎回 PowerShell を起動すると遅いため）。
# 返すのは位置と大きさだけ。ウィンドウのタイトルや中身は一切読まない。

param([int]$SkipPid = 0, [switch]$Serve)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class WinRects
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int DwmGetWindowAttributeInt(IntPtr h, int attr, out int v, int size);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    private const int DWMWA_CLOAKED = 14;

    private const int MAX_CHILDREN = 200;
    private const int MAX_RECTS = 4000;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    public static string GetCursor()
    {
        POINT p;
        GetCursorPos(out p);
        return p.X.ToString(CultureInfo.InvariantCulture) + "," + p.Y.ToString(CultureInfo.InvariantCulture);
    }

    // SetCursorPos だけだと「カーソルの下にある窓」の判定が更新されないことがある。
    // 窓が消えた直後などに、Windows が消えた窓を指したままになり、ホイールがどこにも届かない。
    // 実際のマウス移動を1つ流し込んで判定を作り直させる。
    public static void MoveCursor(int x, int y)
    {
        SetCursorPos(x, y);
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
        int vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        if (vw < 2) vw = 2;
        if (vh < 2) vh = 2;
        int ax = (int)(((double)(x - vx) * 65535.0) / (vw - 1));
        int ay = (int)(((double)(y - vy) * 65535.0) / (vh - 1));
        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, ax, ay, 0, IntPtr.Zero);
    }

    // マウスホイールは「カーソルの下にある窓」に届くので、先にそこへ移してから回す。
    // delta は 120 で1目盛り。下へスクロールするときは負の値。
    public static void Wheel(int x, int y, int delta)
    {
        MoveCursor(x, y);
        System.Threading.Thread.Sleep(15);   // 移動が処理されてから回す
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, IntPtr.Zero);
    }

    // 拡大率が 100% 以外の環境で、実ピクセルのまま座標を受け取るために必要。
    // 付けないと Windows が値を勝手に縮めて返すので、スクリーンショットと位置がずれる。
    public static void MakeDpiAware()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
        catch (EntryPointNotFoundException) { }
        catch (DllNotFoundException) { }
        try { SetProcessDPIAware(); } catch (Exception) { }
    }

    private static bool TopRect(IntPtr h, out RECT r)
    {
        r = new RECT();
        RECT f;
        // 影やつかみ代のぶんの透明な余白を除いた「見た目どおり」の枠
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out f, Marshal.SizeOf(typeof(RECT))) == 0
            && f.R > f.L && f.B > f.T)
        {
            r = f;
            return true;
        }
        return GetWindowRect(h, out r);
    }

    private static void Append(StringBuilder sb, RECT r)
    {
        sb.Append('[');
        sb.Append(r.L.ToString(CultureInfo.InvariantCulture)).Append(',');
        sb.Append(r.T.ToString(CultureInfo.InvariantCulture)).Append(',');
        sb.Append((r.R - r.L).ToString(CultureInfo.InvariantCulture)).Append(',');
        sb.Append((r.B - r.T).ToString(CultureInfo.InvariantCulture));
        sb.Append(']');
    }

    public static string Scan(int skipPid)
    {
        List<RECT> mons = new List<RECT>();
        MonitorEnumProc mcb = delegate(IntPtr hm, IntPtr hdc, ref RECT mr, IntPtr p) { mons.Add(mr); return true; };
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, mcb, IntPtr.Zero);

        StringBuilder sb = new StringBuilder(1 << 16);
        sb.Append("{\"monitors\":[");
        for (int i = 0; i < mons.Count; i++)
        {
            if (i > 0) sb.Append(',');
            Append(sb, mons[i]);
        }
        sb.Append("],\"windows\":[");

        bool firstWin = true;
        int total = 0;

        // EnumWindows は手前にあるものから順に返ってくる。この順番のまま出すので、
        // 受け取った側は「最初に見つかった＝いちばん手前の窓」を選べばよい。
        EnumWindowsProc wcb = delegate(IntPtr h, IntPtr p)
        {
            if (total > MAX_RECTS) return false;
            if (!IsWindowVisible(h) || IsIconic(h)) return true;

            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (skipPid != 0 && pid == (uint)skipPid) return true;

            int cloaked;
            if (DwmGetWindowAttributeInt(h, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TRANSPARENT) != 0) return true;

            RECT r;
            if (!TopRect(h, out r)) return true;
            if (r.R - r.L < 40 || r.B - r.T < 24) return true;

            if (!firstWin) sb.Append(',');
            firstWin = false;
            sb.Append("{\"r\":");
            Append(sb, r);
            sb.Append(",\"c\":[");
            total++;

            bool firstChild = true;
            int count = 0;
            EnumWindowsProc ccb = delegate(IntPtr c, IntPtr q)
            {
                if (count++ > MAX_CHILDREN) return false;
                if (!IsWindowVisible(c)) return true;
                RECT cr;
                if (!GetWindowRect(c, out cr)) return true;
                // 小さすぎる部品（ボタンなど）は選びにくいだけなので入れない
                if (cr.R - cr.L < 60 || cr.B - cr.T < 22) return true;
                // 親と同じ大きさなら重複するだけ
                if (cr.L <= r.L + 2 && cr.T <= r.T + 2 && cr.R >= r.R - 2 && cr.B >= r.B - 2) return true;
                if (!firstChild) sb.Append(',');
                firstChild = false;
                Append(sb, cr);
                total++;
                return true;
            };
            EnumChildWindows(h, ccb, IntPtr.Zero);

            sb.Append("]}");
            return true;
        };
        EnumWindows(wcb, IntPtr.Zero);

        sb.Append("]}");
        return sb.ToString();
    }
}
"@

[WinRects]::MakeDpiAware()

if ($Serve) {
  # 標準入力に1行来るたびに1行返す。閉じられたら終わる。
  #   scan              … ウィンドウの位置一覧(JSON)
  #   cursor            … いまのカーソル位置 "x,y"
  #   move  x y         … カーソルを動かす
  #   wheel x y delta   … そこへ動かしてホイールを回す(120で1目盛り・下は負)
  #   quit              … 終わる
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $p = $line.Trim() -split '\s+'
    $reply = '?'
    switch ($p[0]) {
      'quit'   { break }
      'scan'   { $reply = [WinRects]::Scan($SkipPid) }
      'cursor' { $reply = [WinRects]::GetCursor() }
      'move'   { [WinRects]::MoveCursor([int]$p[1], [int]$p[2]); $reply = 'ok' }
      'wheel'  { [WinRects]::Wheel([int]$p[1], [int]$p[2], [int]$p[3]); $reply = 'ok' }
    }
    if ($p[0] -eq 'quit') { break }
    [Console]::Out.WriteLine($reply)
    [Console]::Out.Flush()
  }
} else {
  [Console]::Out.WriteLine([WinRects]::Scan($SkipPid))
}
