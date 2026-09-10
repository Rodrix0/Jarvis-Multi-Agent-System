param([ValidateSet('audio','brightness')][string]$Device, [ValidateSet('get','set','adjust','mute')][string]$Operation = 'get', [double]$Value = 0)
$ErrorActionPreference = 'Stop'
try {
    if ($Device -eq 'audio') {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice {
    [PreserveSig] int Activate(ref Guid id, int context, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object result);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEndpoint {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float level, Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, Guid context);
    int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
public class JarvisAudio {
    private IEndpoint endpoint;
    public JarvisAudio() {
        IDevice device;
        Marshal.ThrowExceptionForHR(((IDeviceEnumerator)new DeviceEnumerator()).GetDefaultAudioEndpoint(0, 1, out device));
        Guid id = typeof(IEndpoint).GUID;
        object result;
        Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out result));
        endpoint = (IEndpoint)result;
    }
    public double GetVolume() { float value; Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out value)); return Math.Round(value * 100); }
    public void SetVolume(double value) { Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar((float)(value / 100), Guid.Empty)); }
    public bool GetMute() { bool value; Marshal.ThrowExceptionForHR(endpoint.GetMute(out value)); return value; }
    public void SetMute(bool value) { Marshal.ThrowExceptionForHR(endpoint.SetMute(value, Guid.Empty)); }
}
'@
        $audio = New-Object JarvisAudio
        $before = $audio.GetVolume()
        if ($Operation -eq 'set') { $audio.SetVolume([Math]::Max(0, [Math]::Min(100, $Value))) }
        if ($Operation -eq 'adjust') { $audio.SetVolume([Math]::Max(0, [Math]::Min(100, $before + $Value))) }
        if ($Operation -eq 'mute') { $audio.SetMute(-not $audio.GetMute()) }
        @{ ok = $true; volume = $audio.GetVolume(); muted = $audio.GetMute(); previous = $before } | ConvertTo-Json -Compress
    } else {
        $monitor = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Where-Object Active | Select-Object -First 1
        if (-not $monitor) { throw 'El monitor no expone control de brillo WMI.' }
        $before = [int]$monitor.CurrentBrightness
        if ($Operation -ne 'get') {
            $target = if ($Operation -eq 'adjust') { $before + $Value } else { $Value }
            $target = [byte][Math]::Max(0, [Math]::Min(100, $target))
            $method = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Where-Object { $_.InstanceName -eq $monitor.InstanceName } | Select-Object -First 1
            $result = Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = $target }
            if ($null -ne $result.ReturnValue -and $result.ReturnValue -ne 0) { throw "Windows rechazo el ajuste de brillo: $($result.ReturnValue)" }
        }
        $after = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Where-Object { $_.InstanceName -eq $monitor.InstanceName } | Select-Object -First 1
        for ($attempt = 0; $Operation -ne 'get' -and [int]$after.CurrentBrightness -ne $target -and $attempt -lt 10; $attempt++) {
            Start-Sleep -Milliseconds 100
            $after = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Where-Object { $_.InstanceName -eq $monitor.InstanceName } | Select-Object -First 1
        }
        @{ ok = $true; brightness = [int]$after.CurrentBrightness; previous = $before } | ConvertTo-Json -Compress
    }
} catch {
    @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
