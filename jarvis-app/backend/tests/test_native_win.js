const { execSync } = require('child_process');

function runPowerShell(script) {
    const buffer = Buffer.from(script, 'utf16le');
    const base64 = buffer.toString('base64');
    return execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64}`).toString().trim();
}

const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NativeWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@ -ErrorAction SilentlyContinue

$h = [NativeWin]::GetForegroundWindow()
Write-Output "Handle: $h"
`;

console.log(runPowerShell(ps));
