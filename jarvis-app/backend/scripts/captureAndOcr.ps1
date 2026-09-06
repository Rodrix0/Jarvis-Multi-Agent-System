param(
    [string]$OutputPath = "backend\data\screen_capture.png"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# 1. Captura Real con CopyFromScreen (compatible con DWM y aceleración GPU)
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$fullOutPath = [System.IO.Path]::GetFullPath($OutputPath)
$dir = [System.IO.Path]::GetDirectoryName($fullOutPath)
if (-not (Test-Path $dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }

$bmp.Save($fullOutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()

# 2. Obtener título de la ventana activa
$activeWinTitle = ""
try {
    Add-Type -TypeDefinition @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public class WinTitleHelper {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    }
"@ -ErrorAction SilentlyContinue

    $hWnd = [WinTitleHelper]::GetForegroundWindow()
    if ($hWnd -ne [IntPtr]::Zero) {
        $sb = New-Object System.Text.StringBuilder 256
        [WinTitleHelper]::GetWindowText($hWnd, $sb, 256) | Out-Null
        $activeWinTitle = $sb.ToString()
    }
} catch {
    $activeWinTitle = ""
}

# 3. WinRT OCR
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | 
    Select-Object -First 1

function AwaitWinRT($asyncOp, [Type]$type) {
    $asTask = $asTaskGeneric.MakeGenericMethod($type)
    $netTask = $asTask.Invoke($null, @($asyncOp))
    $netTask.Wait()
    return $netTask.Result
}

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($fullOutPath)
$file = AwaitWinRT $fileOp ([Windows.Storage.StorageFile])

$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = AwaitWinRT $streamOp ([Windows.Storage.Streams.IRandomAccessStream])

$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = AwaitWinRT $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

$bmpOp = $decoder.GetSoftwareBitmapAsync()
$softwareBmp = AwaitWinRT $bmpOp ([Windows.Graphics.Imaging.SoftwareBitmap])

$lang = [Windows.Globalization.Language]::new("es-ES")
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }

$ocrOp = $ocr.RecognizeAsync($softwareBmp)
$ocrRes = AwaitWinRT $ocrOp ([Windows.Media.Ocr.OcrResult])

$linesList = @()
if ($ocrRes.Lines) {
    foreach ($line in $ocrRes.Lines) {
        $linesList += $line.Text
    }
}

$resObj = @{
    imagePath = $fullOutPath
    activeWindow = $activeWinTitle
    fullText = $ocrRes.Text
    lines = $linesList
    language = $ocr.RecognizerLanguage.LanguageTag
}

Write-Output ($resObj | ConvertTo-Json -Depth 3 -Compress)
