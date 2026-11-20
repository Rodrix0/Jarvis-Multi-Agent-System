param([string]$Workspace=(Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference='Stop'
$build=Join-Path $Workspace '.local\jarvis-build';$stage=Join-Path $build 'stage';$out=Join-Path $Workspace 'jarvis-app\dist\windows';$app=Join-Path $Workspace 'jarvis-app'
$manifest=Get-Content -LiteralPath (Join-Path $out 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references=@('/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Net.Http.dll','/reference:System.Web.Extensions.dll')
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$stage\Jarvis.exe" @references "/reference:$stage\Microsoft.Web.WebView2.Core.dll" "/reference:$stage\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $PSScriptRoot 'JarvisDesktop.cs')
if($LASTEXITCODE){throw 'No se pudo compilar Jarvis'}
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$stage\JarvisUninstall.exe" @references /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'Installer.cs')
if($LASTEXITCODE){throw 'No se pudo compilar el desinstalador'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$patch=Join-Path $build 'app-final.zip';$stream=[IO.File]::Create($patch);$zip=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
function Add-Entry([string]$Source,[string]$Name){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$Source,$Name.Replace('\','/'),[IO.Compression.CompressionLevel]::Fastest)|Out-Null}
try{
    Add-Entry (Join-Path $stage 'Jarvis.exe') 'Jarvis.exe';Add-Entry (Join-Path $stage 'JarvisUninstall.exe') 'JarvisUninstall.exe';Add-Entry (Join-Path $PSScriptRoot 'INSTALACION.md') 'LEEME.md'
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $app 'frontend') -Recurse -File){Add-Entry $file.FullName ('app/frontend/'+$file.FullName.Substring((Join-Path $app 'frontend').Length+1))}
    foreach($folder in @('services','scripts','routes')){foreach($file in Get-ChildItem -LiteralPath (Join-Path $app ('backend\'+$folder)) -Recurse -File){Add-Entry $file.FullName ('app/backend/'+$file.FullName.Substring((Join-Path $app 'backend').Length+1))}}
    foreach($name in @('server.js','package.json','package-lock.json')){Add-Entry (Join-Path $app ('backend\'+$name)) ('app/backend/'+$name)}
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $stage 'runtime\node_modules\npm') -Recurse -File){Add-Entry $file.FullName ('runtime/node_modules/npm/'+$file.FullName.Substring((Join-Path $stage 'runtime\node_modules\npm').Length+1))}
    foreach($name in @('npm','npm.cmd','npx','npx.cmd')){Add-Entry (Join-Path $stage ('runtime\'+$name)) ('runtime/'+$name)}
}finally{$zip.Dispose();$stream.Dispose()}
$source=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Installer.cs') -Raw -Encoding UTF8).Replace('__PAYLOAD_HASH__',$manifest.sha256)
$generated=Join-Path $build 'Installer.generated.cs';[IO.File]::WriteAllText($generated,$source,[Text.Encoding]::UTF8)
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$out\Jarvis-Setup-1.0.0.exe" @references /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$patch,Jarvis.Patch" $generated
if($LASTEXITCODE){throw 'No se pudo compilar el instalador final'}
$manifest | Add-Member -NotePropertyName setupSha256 -NotePropertyValue ((Get-FileHash -LiteralPath (Join-Path $out 'Jarvis-Setup-1.0.0.exe') -Algorithm SHA256).Hash.ToLowerInvariant()) -Force
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'manifest.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'INSTALACION.md') -Destination (Join-Path $out 'LEEME.md') -Force
Write-Output 'Instalador final: interfaz offline y codigo actualizado incluidos.'
