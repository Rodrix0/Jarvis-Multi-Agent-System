# spotify_play.ps1 — Jarvis Spotify Autoplay
# Uso: powershell -File spotify_play.ps1 "milo j"
param([string]$Query)

if (-not $Query) { exit 1 }

Add-Type -AssemblyName System.Windows.Forms

# 1. Traer Spotify al frente (o abrirlo si no esta abierto)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spotify) {
    Start-Process "spotify:"
    Start-Sleep -Seconds 3
    $spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

if ($spotify) {
    [Win32]::ShowWindow($spotify.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 300
    [Win32]::SetForegroundWindow($spotify.MainWindowHandle) | Out-Null
}

Start-Sleep -Milliseconds 500

# 2. Ctrl+K para abrir/enfocar la barra de busqueda de Spotify
[System.Windows.Forms.SendKeys]::SendWait("^(k)")
Start-Sleep -Milliseconds 500

# 3. Seleccionar todo el texto actual y reemplazar con nuestra query
[System.Windows.Forms.SendKeys]::SendWait("^(a)")
Start-Sleep -Milliseconds 100

$safeQuery = $Query -replace '[{}()\[\]+^%~]', ''
[System.Windows.Forms.SendKeys]::SendWait($safeQuery)
Start-Sleep -Milliseconds 1000

# 4. Enter para ir al top result (pagina del artista/album)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 2

# 5. Ahora estamos en la pagina del artista/album.
#    El boton verde de Play es el primer boton interactivo.
#    Usamos Tab para navegar hasta el y Enter para pulsarlo.
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
