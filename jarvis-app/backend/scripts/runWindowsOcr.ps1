param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

try {
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

    if (-not (Test-Path $ImagePath)) {
        Write-Output (@{ error = "File not found: $ImagePath" } | ConvertTo-Json -Compress)
        exit 0
    }

    $fullPath = (Resolve-Path $ImagePath).Path
    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)
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

    if (-not $ocr) {
        Write-Output (@{ error = "No OCR engine available" } | ConvertTo-Json -Compress)
        exit 0
    }

    $ocrOp = $ocr.RecognizeAsync($bmp)
    $ocrRes = AwaitWinRT $ocrOp ([Windows.Media.Ocr.OcrResult])

    $linesList = @()
    if ($ocrRes.Lines) {
        foreach ($line in $ocrRes.Lines) {
            $linesList += $line.Text
        }
    }

    $output = @{
        ok = $true
        text = $ocrRes.Text
        lines = $linesList
        lineCount = $linesList.Count
        language = $ocr.RecognizerLanguage.LanguageTag
    }

    Write-Output ($output | ConvertTo-Json -Depth 3 -Compress)
} catch {
    $errObj = @{
        ok = $false
        error = $_.Exception.Message
    }
    Write-Output ($errObj | ConvertTo-Json -Compress)
}
