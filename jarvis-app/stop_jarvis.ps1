$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$statePath = Join-Path $projectRoot 'backend\data\local_voice_state.json'
$registryPath = Join-Path $projectRoot 'backend\data\jarvis_started_processes.json'
$stopped = [System.Collections.Generic.List[string]]::new()

function Stop-VerifiedProcess {
    param([int]$ProcessId, [string]$Label, [scriptblock]$Validate)
    if (-not $ProcessId) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return }
    if (-not (& $Validate $process)) {
        Write-Warning "Se omitio $Label (PID $ProcessId): no coincide con Jarvis."
        return
    }
    Stop-Process -Id $ProcessId -ErrorAction Stop
    $stopped.Add("$Label (PID $ProcessId)")
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '              APAGANDO JARVIS OS' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

# Cortar la voz antes de detener el servidor.
try { Invoke-RestMethod 'http://127.0.0.1:3000/api/tts/stop' -Method Post -TimeoutSec 3 | Out-Null } catch {}
try {
    Invoke-RestMethod 'http://127.0.0.1:3000/api/voice/local/state' -Method Post `
        -ContentType 'application/json' -Body '{"state":"dormant"}' -TimeoutSec 3 | Out-Null
} catch {}

New-Item -ItemType Directory -Force -Path (Split-Path $statePath) | Out-Null
'{"state":"dormant","updatedAt":0}' | Set-Content -LiteralPath $statePath -Encoding UTF8

# Puede haber quedado mas de un proceso de voz tras una actualizacion. Cerramos
# solamente los que contienen la ruta exacta de este proyecto.
$escapedRoot = [regex]::Escape($projectRoot)
$allProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
$voiceProcesses = $allProcesses | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -match $escapedRoot -and $_.CommandLine -match 'python_engine\\voice_assistant\.py'
}
foreach ($process in $voiceProcesses) {
    Stop-VerifiedProcess -ProcessId $process.ProcessId -Label 'Voz local' -Validate {
        param($candidate)
        $candidate.Name -eq 'python.exe' -and $candidate.CommandLine -match $escapedRoot -and $candidate.CommandLine -match 'voice_assistant\.py'
    }
}

$pythonConnection = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pythonConnection) {
    Stop-VerifiedProcess -ProcessId $pythonConnection.OwningProcess -Label 'Motor Python' -Validate {
        param($candidate)
        $candidate.Name -eq 'python.exe' -and $candidate.CommandLine -match $escapedRoot -and $candidate.CommandLine -match 'uvicorn'
    }
}

# Node se inicia con "node server.js" y Windows no conserva su carpeta de trabajo
# en la linea de comandos. Confirmamos ademas que el puerto sirve el panel JARVIS.
$isJarvisPanel = $false
try {
    $rootResponse = Invoke-WebRequest 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 3
    $isJarvisPanel = $rootResponse.Content -match 'JARVIS'
} catch {}
$nodeConnection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeConnection -and $isJarvisPanel) {
    Stop-VerifiedProcess -ProcessId $nodeConnection.OwningProcess -Label 'Servidor Node' -Validate {
        param($candidate)
        $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -match 'server\.js'
    }
}

# Ollama solo se cierra si el ultimo inicio registro que Jarvis fue quien lo abrio.
if (Test-Path -LiteralPath $registryPath) {
    try {
        $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
        if ($registry.Ollama) {
            Stop-VerifiedProcess -ProcessId ([int]$registry.Ollama) -Label 'Ollama iniciado por Jarvis' -Validate {
                param($candidate)
                $candidate.Name -eq 'ollama.exe' -and $candidate.CommandLine -match '\bserve\b'
            }
        }
    } catch {
        Write-Warning 'No se pudo leer el registro del ultimo inicio.'
    }
}

'{}' | Set-Content -LiteralPath $registryPath -Encoding UTF8

Write-Host ''
if ($stopped.Count) {
    $stopped | ForEach-Object { Write-Host "[DETENIDO] $_" -ForegroundColor Green }
} else {
    Write-Host '[LISTO] Jarvis ya estaba completamente apagado.' -ForegroundColor DarkGreen
}
Write-Host 'Jarvis quedo apagado. Para iniciarlo otra vez: .\jarvis.cmd' -ForegroundColor Cyan
