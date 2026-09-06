param(
    [Parameter(Mandatory=$false)]
    [string]$ContactName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$MessageText = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUser32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue

$wshell = New-Object -ComObject wscript.shell

if ([string]::IsNullOrWhiteSpace($ContactName) -or [string]::IsNullOrWhiteSpace($MessageText)) {
    Write-Output "ERROR: Faltan parámetros ContactName o MessageText"
    exit 1
}

# 1. Localizar WhatsApp o Navegador activo
$fgHwnd = [WinUser32]::GetForegroundWindow()
$fgPid = 0
[WinUser32]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid) | Out-Null
$fgProc = if ($fgPid -gt 0) { Get-Process -Id $fgPid -ErrorAction SilentlyContinue } else { $null }

if ($fgProc -and ($fgProc.ProcessName -match "(?i)WhatsApp|chrome|msedge|brave")) {
    Write-Output "WhatsApp/Navegador ya está al frente (Process: $($fgProc.ProcessName))."
} else {
    # Buscar si WhatsApp desktop está abierto
    $wa = Get-Process -Name "*WhatsApp*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wa) {
        Write-Output "Trayendo WhatsApp Desktop al frente..."
        $wshell.AppActivate($wa.Id) | Out-Null
        Start-Sleep -Milliseconds 500
    } else {
        # Buscar si el navegador está corriendo
        $browser = Get-Process | Where-Object { $_.ProcessName -match "^(chrome|msedge|brave)$" } | Select-Object -First 1
        if ($browser) {
            Write-Output "Trayendo navegador al frente (PID: $($browser.Id))..."
            $wshell.AppActivate($browser.Id) | Out-Null
            Start-Sleep -Milliseconds 500
        } else {
            Write-Output "Abriendo WhatsApp Web..."
            Start-Process "https://web.whatsapp.com"
            Start-Sleep -Seconds 8
        }
    }
}

# 2. Asegurar foco y limpiar estados de búsqueda
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 250

# 3. Enfocar el buscador de contactos de WhatsApp Web (Ctrl+Alt+/)
[System.Windows.Forms.SendKeys]::SendWait("^%(/)")
Start-Sleep -Milliseconds 350

# Limpiar el campo de búsqueda existente
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}')
Start-Sleep -Milliseconds 150

# 4. Escribir el nombre del contacto mediante Clipboard (soporta tildes como 'cartón', espacios y caracteres especiales)
[System.Windows.Forms.Clipboard]::SetText($ContactName)
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 1000

# 5. Seleccionar el chat encontrado con Down + Enter
[System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 700

# 6. Escribir el mensaje usando el portapapeles para evitar problemas de caracteres especiales
[System.Windows.Forms.Clipboard]::SetText($MessageText)
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 400

# 7. Enviar el mensaje con Enter
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 300

Write-Output "OK: WHATSAPP_MESSAGE_SENT"
