# Dev-only spike S1 check: is the Snap Layouts overlay in place and answering HTMAXBUTTON?
# Usage: powershell -File tools/spikes/s1-snap.ps1 [-Process folio-hello] [-Shot path.png]
param([string]$Process = 'folio-hello', [string]$Shot = "$env:TEMP\folio-snap.png")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SnapCheck {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // `title` is a pointer so we can pass NULL (PowerShell turns $null strings into "").
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, IntPtr title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
  // Tauri's event loop also owns a visible top-level window, so Process.MainWindowHandle
  // isn't reliable: look for the window with Tauri's window class instead.
  public static IntPtr FindTauriWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      var c = new System.Text.StringBuilder(64); GetClassNameW(h, c, 64);
      if (p == pid && c.ToString() == "Tauri Window") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[SnapCheck]::SetProcessDPIAware() | Out-Null

$p = Get-Process $Process -ErrorAction Stop | Select-Object -First 1
$main = [SnapCheck]::FindTauriWindow([uint32]$p.Id)
if ($main -eq [IntPtr]::Zero) { 'FAIL no Tauri window found'; exit 1 }
[SnapCheck]::SetForegroundWindow($main) | Out-Null
Start-Sleep -Milliseconds 300

$overlay = [SnapCheck]::FindWindowExW($main, [IntPtr]::Zero, 'FolioSnapButton', [IntPtr]::Zero)
if ($overlay -eq [IntPtr]::Zero) { 'FAIL no overlay window found'; exit 1 }
"overlay found, visible: $([SnapCheck]::IsWindowVisible($overlay)), window DPI: $([SnapCheck]::GetDpiForWindow($main))"

$r = New-Object SnapCheck+RECT
[SnapCheck]::GetWindowRect($overlay, [ref]$r) | Out-Null
"overlay rect: ($($r.Left), $($r.Top)) size $($r.Right - $r.Left) x $($r.Bottom - $r.Top)"

$cx = [int](($r.Left + $r.Right) / 2); $cy = [int](($r.Top + $r.Bottom) / 2)
$pt = New-Object SnapCheck+POINT; $pt.X = $cx; $pt.Y = $cy
$under = [SnapCheck]::WindowFromPoint($pt)
if ($under -eq $overlay) { 'ok   overlay is the window under the button centre' } else { "FAIL window under the button centre is $under" }

$lparam = [IntPtr](($cy -shl 16) -bor ($cx -band 0xFFFF))
$hit = [SnapCheck]::SendMessageW($overlay, 0x84, [IntPtr]::Zero, $lparam)
if ($hit -eq 9) { 'ok   WM_NCHITTEST returns HTMAXBUTTON (9)' } else { "FAIL WM_NCHITTEST returned $hit" }

# Hover like a person would: real (relative) mouse input moving onto the button, then rest
# on it. Then capture where the flyout appears (below-left of the button).
[SnapCheck]::SetCursorPos($cx - 30, $cy) | Out-Null
Start-Sleep -Milliseconds 150
for ($i = 0; $i -lt 30; $i++) {
  [SnapCheck]::mouse_event(0x0001, 1, 0, 0, [UIntPtr]::Zero)   # MOUSEEVENTF_MOVE
  Start-Sleep -Milliseconds 15
}
Start-Sleep -Milliseconds 2500
$x0 = [Math]::Max(0, $r.Right - 460); $width = 480; $height = 300
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x0, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
"screenshot of the flyout area: $Shot"
