param([string]$Workspace=(Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference='Stop'
$build=Join-Path $Workspace '.local\jarvis-build';$stage=Join-Path $build 'stage';$out=Join-Path $Workspace 'jarvis-app\dist\windows';$app=Join-Path $Workspace 'jarvis-app'
New-Item -ItemType Directory -Force -Path $out,(Join-Path $stage 'app\backend'),(Join-Path $stage 'app\frontend'),(Join-Path $stage 'app\python_engine'),(Join-Path $stage 'licenses') | Out-Null
function Copy-Code([string]$Source,[string]$Destination,[string[]]$Excluded=@()){
    & robocopy.exe $Source $Destination /E /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP /XD node_modules data logs tests __pycache__ dist venv voice_venv models .git @Excluded /XF .env .env.* *.pyc *.log | Out-Null
    if($LASTEXITCODE -gt 7){throw "Error copiando $Source"}
}
Copy-Code (Join-Path $app 'backend') (Join-Path $stage 'app\backend')
Copy-Code (Join-Path $app 'frontend') (Join-Path $stage 'app\frontend')
Get-ChildItem -LiteralPath (Join-Path $app 'python_engine') -File | Where-Object {$_.Extension -in @('.py','.txt','.md')} | Copy-Item -Destination (Join-Path $stage 'app\python_engine')
Copy-Code (Join-Path $app 'python_engine\skills') (Join-Path $stage 'app\python_engine\skills')
$sdk=Join-Path $build 'webview-sdk\sdk'
Copy-Item -LiteralPath (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'),(Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),(Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $stage
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $stage 'licenses\WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $sdk 'NOTICE.txt') -Destination (Join-Path $stage 'licenses\WebView2-NOTICE.txt')
if(Test-Path -LiteralPath 'C:\Program Files\nodejs\LICENSE'){Copy-Item -LiteralPath 'C:\Program Files\nodejs\LICENSE' -Destination (Join-Path $stage 'licenses\Node-LICENSE.txt')}
Copy-Item -LiteralPath (Join-Path $build 'Jarvis.ico') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'INSTALACION.md') -Destination (Join-Path $stage 'LEEME.md')
$csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references=@('/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Net.Http.dll','/reference:System.Web.Extensions.dll')
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$stage\Jarvis.exe" @references "/reference:$stage\Microsoft.Web.WebView2.Core.dll" "/reference:$stage\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $PSScriptRoot 'JarvisDesktop.cs')
if($LASTEXITCODE){throw 'No se pudo compilar Jarvis.exe'}
$zipRefs=@('/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll')
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$stage\JarvisUninstall.exe" @references @zipRefs (Join-Path $PSScriptRoot 'Installer.cs')
if($LASTEXITCODE){throw 'No se pudo compilar el desinstalador'}
Write-Output 'Aplicación compilada. Empaquetando los motores locales…'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath=Join-Path $out 'Jarvis-1.0.0.zip'
$files=Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName
$total=($files|Measure-Object Length -Sum).Sum;$done=0L;$last=0
$stream=[IO.File]::Create($zipPath);$archive=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try{foreach($file in $files){$name=$file.FullName.Substring($stage.Length+1).Replace('\','/');[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$name,[IO.Compression.CompressionLevel]::Fastest)|Out-Null;$done+=$file.Length;$percent=[int]($done*100/[math]::Max([double]1,[double]$total));if($percent -ge $last+5){$last=$percent;Write-Output "Paquete: $percent%"}}}finally{$archive.Dispose();$stream.Dispose()}
$hash=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$source=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Installer.cs') -Raw -Encoding UTF8).Replace('__PAYLOAD_HASH__',$hash)
$generated=Join-Path $build 'Installer.generated.cs';[IO.File]::WriteAllText($generated,$source,[Text.Encoding]::UTF8)
$setup=Join-Path $out 'Jarvis-Setup-1.0.0.exe'
& $csc /nologo /codepage:65001 /target:winexe /platform:x64 "/win32icon:$build\Jarvis.ico" "/out:$setup" @references @zipRefs $generated
if($LASTEXITCODE){throw 'No se pudo compilar el instalador'}
@{product='Jarvis';version='1.0.0';package='Jarvis-1.0.0.zip';sha256=$hash;unpackedBytes=$total;files=$files.Count;externalServices=@('Ollama','Stable Diffusion Forge');webviewSDK='1.0.4314.35'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $out 'manifest.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'INSTALACION.md') -Destination (Join-Path $out 'LEEME.md')
Write-Output "Instalador listo: $setup"
Write-Output "Paquete: $zipPath"
