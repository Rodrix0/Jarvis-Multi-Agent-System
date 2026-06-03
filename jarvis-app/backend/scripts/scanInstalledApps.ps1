$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell

$pathsToScan = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

$apps = @{}

# Parsear .lnk (Accesos Directos Nativos y Steam Win32 wrappers)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Include *.lnk -Recurse | ForEach-Object {
            $shortcut = $shell.CreateShortcut($_.FullName)
            $name = $_.BaseName.ToLowerInvariant().Trim()
            $target = $shortcut.TargetPath

            # Si el target está vacío, ignoramos (casos corruptos o especiales OS)
            if (-Not [string]::IsNullOrWhiteSpace($target)) {
                $apps[$name] = $target
            }
        }
    }
}

# Parsear .url (Juegos de Epic Games, algunos Steam web launchers)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Include *.url -Recurse | ForEach-Object {
             $content = Get-Content $_.FullName -ErrorAction SilentlyContinue
             $urlLine = $content | Where-Object { $_ -match "^URL=(.*)" }
             
             if ($urlLine) {
                 $url = $matches[1].Trim()
                 $name = $_.BaseName.ToLowerInvariant().Trim()
                 $apps[$name] = $url
             }
        }
    }
}

# Parsear todo lo demás en el Escritorio (carpetas, PDFs, TXT, etc.)
$desktopPaths = @(
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

foreach ($path in $desktopPaths) {
    if (Test-Path $path) {
        # Excluimos .lnk y .url porque ya los procesamos de forma especial arriba
        Get-ChildItem -Path $path -Exclude *.lnk,*.url | ForEach-Object {
            $name = $_.BaseName.ToLowerInvariant().Trim()
            $target = $_.FullName
            
            # Si es un nombre válido y no lo pisamos con un acceso directo
            if (-Not [string]::IsNullOrWhiteSpace($name) -and -not $apps.ContainsKey($name)) {
                $apps[$name] = $target
            }
        }
    }
}

# Retornar como JSON
$apps | ConvertTo-Json -Compress
