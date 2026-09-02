const { execSync } = require('child_process');

class ActivityDetectionService {
    detectCurrentActivity() {
        const script = `
            Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                public class WinApi {
                    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
                }
"@
            $hwnd = [WinApi]::GetForegroundWindow()
            $sb = New-Object System.Text.StringBuilder 256
            [WinApi]::GetWindowText($hwnd, $sb, 256) | Out-Null
            $sb.ToString()
        `;

        try {
            const title = execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 3000 }).toString().trim().toLowerCase();

            if (title.includes('valorant') || title.includes('league of legends') || title.includes('steam') || title.includes('game') || title.includes('witcher')) {
                return { activity: 'Gaming', confidence: 0.90, foregroundTitle: title };
            }
            if (title.includes('visual studio') || title.includes('code') || title.includes('cursor') || title.includes('powershell') || title.includes('cmd')) {
                return { activity: 'Working', confidence: 0.88, foregroundTitle: title };
            }
            if (title.includes('netflix') || title.includes('youtube') || title.includes('stremio') || title.includes('vlc') || title.includes('spotify')) {
                return { activity: 'WatchingMedia', confidence: 0.85, foregroundTitle: title };
            }

            return { activity: 'Working', confidence: 0.70, foregroundTitle: title || 'Desktop' };
        } catch (e) {
            return { activity: 'Working', confidence: 0.60, foregroundTitle: 'Unknown' };
        }
    }
}

const activityDetectionService = new ActivityDetectionService();
module.exports = activityDetectionService;
