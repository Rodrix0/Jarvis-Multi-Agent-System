Add-Type -AssemblyName System.Runtime.WindowsRuntime

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

$imagePath = (Resolve-Path "backend\data\test_screen.png").Path
$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)
$file = AwaitWinRT $fileOp ([Windows.Storage.StorageFile])

$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = AwaitWinRT $streamOp ([Windows.Storage.Streams.IRandomAccessStream])

$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = AwaitWinRT $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

$bmpOp = $decoder.GetSoftwareBitmapAsync()
$bmp = AwaitWinRT $bmpOp ([Windows.Graphics.Imaging.SoftwareBitmap])

$lang = [Windows.Globalization.Language]::new("es-ES")
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }

$ocrOp = $ocr.RecognizeAsync($bmp)
$ocrRes = AwaitWinRT $ocrOp ([Windows.Media.Ocr.OcrResult])

Write-Output "OCR SUCCESS!"
Write-Output "Lines count: $($ocrRes.Lines.Count)"
Write-Output "Sample text: $($ocrRes.Text.Substring(0, [Math]::Min(200, $ocrRes.Text.Length)))"
