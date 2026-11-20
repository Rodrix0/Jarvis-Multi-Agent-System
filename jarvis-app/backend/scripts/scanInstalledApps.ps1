$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell

$pathsToScan = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

$apps = @{}

function Add-AppWithAliases($name, $target) {
    if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($target)) { return }
    $cleanName = $name.ToLowerInvariant().Trim()
    if (-not $apps.ContainsKey($cleanName)) {
        $apps[$cleanName] = $target
    }

    # Generar alias inteligentes
    # 1. Sin espacios: "fc 26" -> "fc26", "ea sports fc 26" -> "easportsfc26"
    $noSpaces = $cleanName -replace '\s+', ''
    if ($noSpaces.Length -gt 2 -and -not $apps.ContainsKey($noSpaces)) {
        $apps[$noSpaces] = $target
    }

    # 2. Si el nombre tiene "ea sports fc 26", agregar "fc 26", "fc26", "ea fc 26"
    if ($cleanName -match '\bfc\s*(\d+)\b') {
        $fcNum = $matches[1]
        $apps["fc $fcNum"] = $target
        $apps["fc$fcNum"] = $target
        $apps["ea fc $fcNum"] = $target
        $apps["ea fc$fcNum"] = $target
        $apps["fifa $fcNum"] = $target
        $apps["fifa$fcNum"] = $target
    }

    # 3. Si es un ejecutable .exe, agregar el nombre del ejecutable como alias
    if ($target -match '\.exe$' -and (Test-Path $target)) {
        $exeBase = [System.IO.Path]::GetFileNameWithoutExtension($target).ToLowerInvariant().Trim()
        if ($exeBase.Length -gt 1 -and -not $apps.ContainsKey($exeBase)) {
            $apps[$exeBase] = $target
            $exeNoSpaces = $exeBase -replace '\s+', ''
            if ($exeNoSpaces.Length -gt 1) { $apps[$exeNoSpaces] = $target }
        }
    }
}

# 1. Parsear .lnk (Accesos directos)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Filter *.lnk -Recurse -Depth 4 | ForEach-Object {
            try {
                $shortcut = $shell.CreateShortcut($_.FullName)
                $name = $_.BaseName
                $target = $shortcut.TargetPath
                if (-not [string]::IsNullOrWhiteSpace($target) -and (Test-Path $target)) {
                    # Preserve shortcut arguments, working directory and launcher flags.
                    Add-AppWithAliases $name $_.FullName
                } else {
                    Add-AppWithAliases $name $_.FullName
                }
            } catch {}
        }
    }
}

# 2. Parsear .url (Juegos de Epic Games, Steam web launchers)
foreach ($path in $pathsToScan) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Filter *.url -Recurse -Depth 4 | ForEach-Object {
            try {
                $content = Get-Content $_.FullName -ErrorAction SilentlyContinue
                $urlLine = $content | Where-Object { $_ -match "^URL=(.*)" }
                if ($urlLine) {
                    $url = $matches[1].Trim()
                    $name = $_.BaseName
                    Add-AppWithAliases $name $url
                }
            } catch {}
        }
    }
}

# 3. Parsear elementos del Escritorio (carpetas, ejecutables y accesos directos únicamente)
$desktopPaths = @(
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop"
)

$excludedExts = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.mp4', '.mkv', '.avi', '.mp3', '.wav', '.zip', '.rar', '.7z', '.tar', '.gz', '.txt', '.pdf', '.docx', '.xlsx', '.pptx')

foreach ($path in $desktopPaths) {
    if (Test-Path $path) {
        Get-ChildItem -Path $path -Recurse -Depth 3 | ForEach-Object {
            $ext = $_.Extension.ToLowerInvariant()
            if ($excludedExts -contains $ext) { return }

            $name = $_.BaseName
            $target = $_.FullName

            # Registrar si es contenedor (carpeta) o ejecutable/acceso directo
            if ($_.PSIsContainer) {
                Add-AppWithAliases $name $target
                Add-AppWithAliases $_.Name $target
            } elseif ($ext -in @('.exe', '.lnk', '.url', '.bat', '.cmd')) {
                Add-AppWithAliases $name $target
            }
        }
    }
}

# 4. Escanear carpetas de juegos de Steam comunes
$steamCommon = "C:\Program Files (x86)\Steam\steamapps\common"
if (Test-Path $steamCommon) {
    Get-ChildItem -Path $steamCommon -Directory -Depth 1 | ForEach-Object {
        $gameName = $_.Name
        $gameFolder = $_.FullName
        # Buscar ejecutable principal (excluyendo crash, report, helper, anticheat)
        $allExes = Get-ChildItem -Path $gameFolder -Filter *.exe -Depth 2 | Where-Object { $_.Name -notmatch "anticheat|crash|report|unins|setup|dx|vcredist|unity|service|helper|installer" }
        $mainExe = $allExes | Where-Object { $_.BaseName -match ($gameName -replace '[^a-zA-Z0-9]', '') } | Select-Object -First 1
        if (-not $mainExe) { $mainExe = $allExes | Select-Object -First 1 }
        
        if ($mainExe) {
            Add-AppWithAliases $gameName $mainExe.FullName
        } else {
            Add-AppWithAliases $gameName $gameFolder
        }
    }
}

# 5. Escanear EA Games, Epic Games, Riot Games
$gameRoots = @(
    "C:\Program Files\EA Games",
    "C:\Program Files (x86)\EA Games",
    "C:\Program Files\Epic Games",
    "C:\Riot Games",
    "C:\Games"
)

foreach ($root in $gameRoots) {
    if (Test-Path $root) {
        Get-ChildItem -Path $root -Directory -Depth 1 | ForEach-Object {
            $gameName = $_.Name
            $gameFolder = $_.FullName
            $allExes = Get-ChildItem -Path $gameFolder -Filter *.exe -Recurse -Depth 2 | Where-Object { $_.Name -notmatch "anticheat|crash|report|unins|setup|dx|vcredist|trial|showcase|service|helper" }
            $mainExe = $allExes | Where-Object { $_.BaseName -match "FC26|Game|Launch|Play" -or $_.BaseName -match ($gameName -replace '[^a-zA-Z0-9]', '') } | Select-Object -First 1
            if (-not $mainExe) { $mainExe = $allExes | Select-Object -First 1 }
            
            if ($mainExe) {
                Add-AppWithAliases $gameName $mainExe.FullName
            } else {
                Add-AppWithAliases $gameName $gameFolder
            }
        }
    }
}

# Retornar como JSON
$apps | ConvertTo-Json -Compress
