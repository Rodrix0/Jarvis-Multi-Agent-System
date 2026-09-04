param(
    [string]$FilePath
)

if (-not $FilePath) {
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $FilePath = Join-Path $desktop ("Captura_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ".png")
}

$source = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ScreenCaptureHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern IntPtr ReleaseDC(IntPtr hWnd, IntPtr hDC);
    
    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);
    
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);
    
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    
    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hDC);
    
    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);
    
    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public static bool Capture(string filePath) {
        try {
            int width = GetSystemMetrics(0);  // SM_CXSCREEN
            int height = GetSystemMetrics(1); // SM_CYSCREEN
            
            IntPtr deskDC = GetWindowDC(GetDesktopWindow());
            IntPtr memDC = CreateCompatibleDC(deskDC);
            IntPtr hBmp = CreateCompatibleBitmap(deskDC, width, height);
            IntPtr hOld = SelectObject(memDC, hBmp);
            
            BitBlt(memDC, 0, 0, width, height, deskDC, 0, 0, 0x00CC0020); // SRCCOPY
            SelectObject(memDC, hOld);
            
            using (Bitmap bmp = Image.FromHbitmap(hBmp)) {
                bmp.Save(filePath, ImageFormat.Png);
            }
            
            DeleteObject(hBmp);
            DeleteDC(memDC);
            ReleaseDC(GetDesktopWindow(), deskDC);
            return true;
        } catch {
            return false;
        }
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing

$success = [ScreenCaptureHelper]::Capture($FilePath)
if ($success) {
    Write-Output $FilePath
} else {
    throw "Error al capturar pantalla"
}
