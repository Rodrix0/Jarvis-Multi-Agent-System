param([string]$Workspace = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference='Stop'
$stage=Join-Path $Workspace '.local\jarvis-build\stage'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
function Copy-Tree([string]$Source,[string]$Destination,[string[]]$Exclude=@()) {
    if(-not(Test-Path -LiteralPath $Source)){throw "Falta dependencia: $Source"}
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $args=@($Source,$Destination,'/E','/R:1','/W:1','/MT:8','/NFL','/NDL','/NJH','/NJS','/NP','/XD','__pycache__')+$Exclude
    & robocopy.exe @args | Out-Null
    if($LASTEXITCODE -gt 7){throw "No se pudo copiar $Source (robocopy $LASTEXITCODE)"}
    Write-Output "Copiado: $Destination"
}
function Get-Home([string]$Config){
    $line=Get-Content -LiteralPath $Config | Where-Object {$_ -match '^home\s*='} | Select-Object -First 1
    if(-not $line){throw "No se pudo resolver Python en $Config"}
    return ($line -split '=',2)[1].Trim()
}
$app=Join-Path $Workspace 'jarvis-app'
$voiceHome=Get-Home (Join-Path $app 'python_engine\voice_venv\pyvenv.cfg')
$generalHome=Get-Home (Join-Path $app 'python_engine\venv\pyvenv.cfg')
$ttsHome=Join-Path $env:APPDATA 'VoiceStudio\runtime\.python\cpython-3.11.16-windows-x86_64-none'
foreach($spec in @(@('python-voice',$voiceHome,(Join-Path $app 'python_engine\voice_venv\Lib\site-packages')),@('python-general',$generalHome,(Join-Path $app 'python_engine\venv\Lib\site-packages')),@('python-tts',$ttsHome,(Join-Path $env:APPDATA 'OmniVoice\engines\supertonic3\supertonic3\.venv\Lib\site-packages')))){
    $target=Join-Path $stage ('runtime\'+$spec[0])
    Copy-Tree $spec[1] $target @('site-packages','__pycache__','Doc','Tools')
    Copy-Tree $spec[2] (Join-Path $target 'Lib\site-packages')
}
Copy-Tree (Join-Path $app 'python_engine\models') (Join-Path $stage 'app\python_engine\models')
Copy-Tree (Join-Path $env:LOCALAPPDATA 'OmniVoice\hf_cache\models--Supertone--supertonic-3\snapshots\724fb5abbf5502583fb520898d45929e62f02c0b') (Join-Path $stage 'runtime\supertonic-3')
Copy-Tree (Join-Path $app 'backend\node_modules') (Join-Path $stage 'app\backend\node_modules')
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Tree 'C:\Program Files\nodejs\node_modules\npm' (Join-Path $stage 'runtime\node_modules\npm')
foreach($name in @('npm','npm.cmd','npx','npx.cmd')){Copy-Item -LiteralPath (Join-Path 'C:\Program Files\nodejs' $name) -Destination (Join-Path $stage 'runtime')}
foreach($name in @('voice_venv','venv')){
    $target=Join-Path $stage ('app\python_engine\'+$name+'\Scripts')
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -LiteralPath (Join-Path $app ('python_engine\'+$name+'\Scripts\python.exe')) -Destination $target
}
$rootVenv=Join-Path $stage '.venv\Scripts';New-Item -ItemType Directory -Force -Path $rootVenv | Out-Null
Copy-Item -LiteralPath (Join-Path $app 'python_engine\venv\Scripts\python.exe') -Destination $rootVenv
Write-Output 'Entornos y modelos de voz preparados. No se copiaron memorias ni credenciales al instalador.'
