param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$logDir = Join-Path $projectRoot 'logs'
$dataDir = Join-Path $projectRoot 'backend\data'
$voicePython = Join-Path $projectRoot 'python_engine\voice_venv\Scripts\python.exe'
$voiceScript = Join-Path $projectRoot 'python_engine\voice_assistant.py'
$pythonEngine = Join-Path $projectRoot 'python_engine\venv\Scripts\python.exe'
$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'

New-Item -ItemType Directory -Force -Path $logDir, $dataDir | Out-Null

function Test-HttpService([string]$Url) {
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-HttpService {
    param(
        [string]$Name,
        [string]$Url,
        [int]$Attempts = 60
    )
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        if (Test-HttpService $Url) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name no respondio. Revisa los registros dentro de $logDir"
}

function Test-LocalVoiceService {
    try {
        $status = Invoke-RestMethod 'http://127.0.0.1:3000/api/voice/local/status' -TimeoutSec 2
        if (-not $status.online -or -not $status.pid) { return $false }
        return $null -ne (Get-Process -Id $status.pid -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Start-HiddenProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )
    $safeName = $Name.ToLowerInvariant().Replace(' ', '-')
    $stdout = Join-Path $logDir "$safeName.out.log"
    $stderr = Join-Path $logDir "$safeName.err.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Write-Host "[INICIADO] $Name (PID $($process.Id))" -ForegroundColor Green
    return $process.Id
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '             INICIANDO JARVIS OS' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

$started = [ordered]@{}

if (-not (Test-HttpService 'http://127.0.0.1:11434/api/version')) {
    if (-not (Test-Path -LiteralPath $ollamaExe)) {
        throw "No encontré Ollama en $ollamaExe"
    }
    $started.Ollama = Start-HiddenProcess -Name 'Ollama' -FilePath $ollamaExe -Arguments @('serve') -WorkingDirectory $projectRoot
    Wait-HttpService -Name 'Ollama' -Url 'http://127.0.0.1:11434/api/version' -Attempts 20
} else {
    Write-Host '[ACTIVO] Ollama' -ForegroundColor DarkGreen
}

if (-not (Test-HttpService 'http://127.0.0.1:8000/docs')) {
    if (Test-Path -LiteralPath $pythonEngine) {
        $started.PythonEngine = Start-HiddenProcess -Name 'Jarvis Python Engine' `
            -FilePath $pythonEngine `
            -Arguments @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000') `
            -WorkingDirectory (Join-Path $projectRoot 'python_engine')
        Wait-HttpService -Name 'El motor Python' -Url 'http://127.0.0.1:8000/docs'
    } else {
        throw 'No se encontro el entorno del motor Python general.'
    }
} else {
    Write-Host '[ACTIVO] Motor Python' -ForegroundColor DarkGreen
}

if (-not (Test-HttpService 'http://127.0.0.1:3000/api/voice/settings')) {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'No se encontro node.exe. Instala Node.js o agregalo al PATH.' }
    $started.Node = Start-HiddenProcess -Name 'Jarvis Node Server' `
        -FilePath $node.Source -Arguments @('server.js') `
        -WorkingDirectory (Join-Path $projectRoot 'backend')
    Wait-HttpService -Name 'El servidor Node' -Url 'http://127.0.0.1:3000/api/voice/settings'
} else {
    Write-Host '[ACTIVO] Servidor Node y panel' -ForegroundColor DarkGreen
}

if (-not (Test-Path -LiteralPath $voicePython) -or -not (Test-Path -LiteralPath $voiceScript)) {
    throw 'No encontré el entorno de voz local. Ejecutá la instalación del motor de voz.'
}

$voiceAlreadyRunning = Test-LocalVoiceService

if (-not $voiceAlreadyRunning) {
    $started.LocalVoice = Start-HiddenProcess -Name 'Jarvis Local Voice' `
        -FilePath $voicePython -Arguments @($voiceScript) -WorkingDirectory $projectRoot
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-LocalVoiceService) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-LocalVoiceService)) {
        throw "La voz local no respondio. Revisa los registros dentro de $logDir"
    }
} else {
    Write-Host '[ACTIVO] Voz local' -ForegroundColor DarkGreen
}

$started | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataDir 'jarvis_started_processes.json') -Encoding UTF8

if (-not $NoBrowser) {
    Start-Process 'http://localhost:3000'
}

Write-Host ''
Write-Host 'Jarvis esta listo.' -ForegroundColor Green
Write-Host 'Deci: "Jarvis, prendete"' -ForegroundColor Cyan
Write-Host "Registros: $logDir" -ForegroundColor DarkGray
