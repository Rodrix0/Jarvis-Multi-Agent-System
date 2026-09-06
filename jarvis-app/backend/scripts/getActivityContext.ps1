Add-Type @"
using System;
using System.Runtime.InteropServices;
public class User32Util {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$hwnd = [User32Util]::GetForegroundWindow()
$title = ""
$processName = ""
$pidVal = 0

if ($hwnd -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder(512)
    [void][User32Util]::GetWindowText($hwnd, $sb, 512)
    $title = $sb.ToString()
    
    [uint32]$procId = 0
    [void][User32Util]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $pidVal = $procId
    if ($procId -gt 0) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            $processName = $p.ProcessName
        }
    }
}

$monitorWidth = 1920
$monitorHeight = 1080
$isPrimary = $true

try {
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
    if ($screen) {
        $monitorWidth = $screen.Bounds.Width
        $monitorHeight = $screen.Bounds.Height
        $isPrimary = $screen.Primary
    }
} catch {}

$result = [PSCustomObject]@{
    Title = $title
    ProcessName = $processName
    ProcessId = $pidVal
    Hwnd = $hwnd.ToInt64()
    Monitor = [PSCustomObject]@{
        Width = $monitorWidth
        Height = $monitorHeight
        IsPrimary = $isPrimary
    }
}

$result | ConvertTo-Json -Compress
