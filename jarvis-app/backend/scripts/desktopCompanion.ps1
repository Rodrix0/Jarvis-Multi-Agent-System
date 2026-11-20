param(
    [int]$Port = 3000,
    [string]$Token,
    [switch]$CheckOnly,
    [string]$RenderTest,
    [string]$RenderAnimation
)
$ErrorActionPreference = 'Stop'
$assemblies = @('PresentationFramework', 'PresentationCore', 'WindowsBase', 'System.Xaml', 'System.Net.Http', 'System.Web.Extensions')
foreach ($assembly in $assemblies) { Add-Type -AssemblyName $assembly }
$references = $assemblies | ForEach-Object { [Reflection.Assembly]::LoadWithPartialName($_).Location }
Add-Type -Path @((Join-Path $PSScriptRoot 'RigCharacter.cs'), (Join-Path $PSScriptRoot 'DesktopCompanion.cs')) -ReferencedAssemblies ($references + @('System.dll', 'System.Core.dll'))
if ($CheckOnly) { Write-Output 'Desktop companion compiled successfully'; exit }
$asset = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../frontend/assets/jarvis-companion.png'))
if ($RenderAnimation) { [JarvisDesktop.RigCharacter]::RenderPreview((Join-Path ([IO.Path]::GetDirectoryName($asset)) 'jarvis-rig.json'), $RenderAnimation); exit }
if ($RenderTest) { [JarvisDesktop.Companion]::RenderTest($asset, $RenderTest); exit }
[JarvisDesktop.Companion]::Run($Port, $Token, $asset)
