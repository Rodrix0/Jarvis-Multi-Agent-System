param(
    [string]$Action = "minimize",
    [int]$TabNumber = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUser32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue

$wsh = New-Object -ComObject WScript.Shell

switch ($Action.ToLower()) {
    "minimize" {
        # Cerrar menús colgados si los hay
        $wsh.SendKeys("{ESC}")
        Start-Sleep -Milliseconds 50
        $h = [WinUser32]::GetForegroundWindow()
        if ($h -ne [IntPtr]::Zero) {
            [WinUser32]::ShowWindowAsync($h, 6) | Out-Null
        } else {
            (New-Object -ComObject Shell.Application).MinimizeAll()
        }
        Write-Output "OK: MINIMIZE"
    }
    "minimize_all" {
        $wsh.SendKeys("{ESC}")
        (New-Object -ComObject Shell.Application).MinimizeAll()
        Write-Output "OK: MINIMIZE_ALL"
    }
    "maximize" {
        $wsh.SendKeys("{ESC}")
        Start-Sleep -Milliseconds 50
        $h = [WinUser32]::GetForegroundWindow()
        if ($h -ne [IntPtr]::Zero) {
            [WinUser32]::ShowWindowAsync($h, 3) | Out-Null
        }
        Write-Output "OK: MAXIMIZE"
    }
    "restore" {
        $wsh.SendKeys("{ESC}")
        $h = [WinUser32]::GetForegroundWindow()
        if ($h -ne [IntPtr]::Zero) {
            [WinUser32]::ShowWindowAsync($h, 9) | Out-Null
        }
        Write-Output "OK: RESTORE"
    }
    "next_tab" {
        $wsh.SendKeys("^{TAB}")
        Write-Output "OK: NEXT_TAB"
    }
    "prev_tab" {
        $wsh.SendKeys("^+{TAB}")
        Write-Output "OK: PREV_TAB"
    }
    "close_tab" {
        $wsh.SendKeys("^w")
        Write-Output "OK: CLOSE_TAB"
    }
    "new_tab" {
        $wsh.SendKeys("^t")
        Write-Output "OK: NEW_TAB"
    }
    "go_to_tab" {
        # Pestaña 1 a 8 -> Ctrl+1 a Ctrl+8. Pestaña 9 o superior -> Ctrl+9 (última pestaña en Chrome/Brave/Edge)
        $num = [Math]::Min(9, [Math]::Max(1, $TabNumber))
        $wsh.SendKeys("^$num")
        Write-Output "OK: GO_TO_TAB_$num"
    }
    "close_window" {
        $wsh.SendKeys("%{F4}")
        Write-Output "OK: CLOSE_WINDOW"
    }
    "next_window" {
        $wsh.SendKeys("%{TAB}")
        Write-Output "OK: NEXT_WINDOW"
    }
    default {
        Write-Output "ERROR: Unknown action $Action"
    }
}
