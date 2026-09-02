$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell

$pathsToScan = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

$apps = @{}

# 1. Parsear .lnk (Accesos directos)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Filter *.lnk -Recurse | ForEach-Object {
            try {
                $shortcut = $shell.CreateShortcut($_.FullName)
                $name = $_.BaseName.ToLowerInvariant().Trim()
                $target = $shortcut.TargetPath
                if (-not [string]::IsNullOrWhiteSpace($target)) {
                    $apps[$name] = $target
                } elseif (-not [string]::IsNullOrWhiteSpace($_.FullName)) {
                    $apps[$name] = $_.FullName
                }
            } catch {}
        }
    }
}

# 2. Parsear .url (Juegos de Epic Games, Steam web launchers)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Filter *.url -Recurse | ForEach-Object {
            try {
                $content = Get-Content $_.FullName -ErrorAction SilentlyContinue
                $urlLine = $content | Where-Object { $_ -match "^URL=(.*)" }
                if ($urlLine) {
                    $url = $matches[1].Trim()
                    $name = $_.BaseName.ToLowerInvariant().Trim()
                    $apps[$name] = $url
                }
            } catch {}
        }
    }
}

# 3. Parsear elementos directos del Escritorio (carpetas, PDFs, ejecutables, scripts, etc.)
$desktopPaths = @(
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

foreach ($path in $desktopPaths) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path | ForEach-Object {
            $name = $_.BaseName.ToLowerInvariant().Trim()
            $target = $_.FullName
            if (-not [string]::IsNullOrWhiteSpace($name) -and -not $apps.ContainsKey($name)) {
                $apps[$name] = $target
            }
        }
    }
}

# Retornar como JSON
$apps | ConvertTo-Json -Compress
