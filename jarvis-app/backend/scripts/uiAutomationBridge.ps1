# PowerShell UI Automation Bridge for Jarvis
param (
    [string]$Action = "list-windows",
    [string]$TitlePattern = "",
    [long]$Hwnd = 0,
    [string]$ControlType = "Any",
    [string]$NamePattern = "",
    [string]$AutomationId = "",
    [string]$Text = "",
    [string]$Option = "",
    [int]$TimeoutMs = 5000
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$csharp = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class UiWin32 {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP   = 0x0004;

    public class WindowEntry {
        public long Hwnd;
        public string Title;
        public string ClassName;
        public uint ProcessId;
    }

    public static List<WindowEntry> GetDesktopWindows() {
        var list = new List<WindowEntry>();
        IntPtr hDesk = OpenInputDesktop(0, false, 0x01ff);
        if (hDesk != IntPtr.Zero) {
            SetThreadDesktop(hDesk);
        }

        EnumDesktopWindows(hDesk, (hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(512);
                int len = GetWindowText(hWnd, sb, 512);
                if (len > 0) {
                    var cb = new StringBuilder(256);
                    GetClassName(hWnd, cb, 256);
                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    list.Add(new WindowEntry {
                        Hwnd = (long)hWnd,
                        Title = sb.ToString(),
                        ClassName = cb.ToString(),
                        ProcessId = pid
                    });
                }
            }
            return true;
        }, IntPtr.Zero);

        if (hDesk != IntPtr.Zero) {
            CloseDesktop(hDesk);
        }
        return list;
    }

    public static void SimulateClick(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Ensure-Desktop {
    $hDesk = [UiWin32]::OpenInputDesktop(0, $false, 0x01ff)
    if ($hDesk -ne [IntPtr]::Zero) {
        $null = [UiWin32]::SetThreadDesktop($hDesk)
    }
}

function Format-Element($elem) {
    if (-not $elem) { return $null }
    try {
        $cur = $elem.Current
        $rect = $cur.BoundingRectangle
        $hasCoords = ($rect.X -ne [double]::PositiveInfinity -and $rect.Width -gt 0)
        $val = $null
        try {
            $vp = $elem.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { $val = $vp.Current.Value }
        } catch {}

        return @{
            name = $cur.Name
            value = $val
            automationId = $cur.AutomationId
            controlType = $cur.ControlType.ProgrammaticName.Replace("ControlType.", "")
            className = $cur.ClassName
            isEnabled = $cur.IsEnabled
            isOffscreen = $cur.IsOffscreen
            bounds = @{
                x = if ($hasCoords) { [int]$rect.X } else { $null }
                y = if ($hasCoords) { [int]$rect.Y } else { $null }
                width = if ($hasCoords) { [int]$rect.Width } else { $null }
                height = if ($hasCoords) { [int]$rect.Height } else { $null }
                centerX = if ($hasCoords) { [int]($rect.X + ($rect.Width / 2)) } else { $null }
                centerY = if ($hasCoords) { [int]($rect.Y + ($rect.Height / 2)) } else { $null }
            }
        }
    } catch {
        return @{ error = $_.Exception.Message }
    }
}

switch ($Action.ToLower()) {
    "list-windows" {
        $wins = [UiWin32]::GetDesktopWindows()
        $result = @{ ok = $true; windows = $wins }
        Write-Output ($result | ConvertTo-Json -Depth 3 -Compress)
        exit 0
    }

    "find-window" {
        $wins = [UiWin32]::GetDesktopWindows()
        $matched = @()
        foreach ($w in $wins) {
            if (-not $TitlePattern -or $w.Title -match [regex]::Escape($TitlePattern) -or $w.Title -like "*$TitlePattern*") {
                $matched += $w
            }
        }
        $result = @{
            ok = $true
            matched = ($matched.Count -gt 0)
            window = if ($matched.Count -gt 0) { $matched[0] } else { $null }
            candidates = $matched
        }
        Write-Output ($result | ConvertTo-Json -Depth 3 -Compress)
        exit 0
    }

    "find-elements" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido o no especificado." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
            if (-not $rootElem) {
                Write-Output (@{ ok = $false; error = "No se pudo obtener AutomationElement para el Hwnd $Hwnd." } | ConvertTo-Json -Compress)
                exit 1
            }

            $condition = [System.Windows.Automation.Condition]::TrueCondition
            if ($ControlType -and $ControlType -ne "Any") {
                $typeField = [System.Windows.Automation.ControlType].GetField($ControlType)
                if ($typeField) {
                    $cType = $typeField.GetValue($null)
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $cType)
                }
            }

            $elements = $rootElem.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            $list = @()
            foreach ($el in $elements) {
                try {
                    $name = $el.Current.Name
                    $autoId = $el.Current.AutomationId
                    
                    $nameMatches = $true
                    if ($NamePattern) {
                        $nameMatches = ($name -and ($name -like "*$NamePattern*" -or $name -match [regex]::Escape($NamePattern)))
                    }
                    $idMatches = $true
                    if ($AutomationId) {
                        $idMatches = ($autoId -and ($autoId -eq $AutomationId -or $autoId -like "*$AutomationId*"))
                    }

                    if ($nameMatches -and $idMatches) {
                        $formatted = Format-Element $el
                        if ($formatted) { $list += $formatted }
                    }
                } catch {}
            }

            $result = @{
                ok = $true
                count = $list.Count
                elements = $list
            }
            Write-Output ($result | ConvertTo-Json -Depth 4 -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    "click-element" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            [UiWin32]::SetForegroundWindow([IntPtr]$Hwnd)
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
            
            $condition = [System.Windows.Automation.Condition]::TrueCondition
            if ($ControlType -and $ControlType -ne "Any") {
                $typeField = [System.Windows.Automation.ControlType].GetField($ControlType)
                if ($typeField) {
                    $cType = $typeField.GetValue($null)
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $cType)
                }
            }

            $elements = $rootElem.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            $target = $null
            foreach ($el in $elements) {
                try {
                    $name = $el.Current.Name
                    $autoId = $el.Current.AutomationId
                    if ($NamePattern -and $name -and ($name -like "*$NamePattern*" -or $name -match [regex]::Escape($NamePattern))) {
                        $target = $el
                        break
                    }
                    if ($AutomationId -and $autoId -and ($autoId -eq $AutomationId)) {
                        $target = $el
                        break
                    }
                } catch {}
            }

            if (-not $target) {
                Write-Output (@{ ok = $false; error = "Elemento '$NamePattern' no encontrado en la ventana." } | ConvertTo-Json -Compress)
                exit 1
            }

            $methodUsed = "none"
            # 1. Intentar InvokePattern
            try {
                $invokePattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                if ($invokePattern) {
                    $invokePattern.Invoke()
                    $methodUsed = "InvokePattern"
                }
            } catch {}

            # 2. Intentar TogglePattern si no funcionó InvokePattern
            if ($methodUsed -eq "none") {
                try {
                    $togglePattern = $target.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                    if ($togglePattern) {
                        $togglePattern.Toggle()
                        $methodUsed = "TogglePattern"
                    }
                } catch {}
            }

            # 3. Fallback inteligente a coordenadas dinámicas del elemento
            if ($methodUsed -eq "none") {
                $rect = $target.Current.BoundingRectangle
                if ($rect.X -ne [double]::PositiveInfinity -and $rect.Width -gt 0) {
                    $cx = [int]($rect.X + ($rect.Width / 2))
                    $cy = [int]($rect.Y + ($rect.Height / 2))
                    [UiWin32]::SimulateClick($cx, $cy)
                    $methodUsed = "CoordinateFallback ($cx, $cy)"
                } else {
                    Write-Output (@{ ok = $false; error = "El elemento no soporta patrones de invocación ni tiene coordenadas visibles." } | ConvertTo-Json -Compress)
                    exit 1
                }
            }

            Write-Output (@{
                ok = $true
                element = (Format-Element $target)
                method = $methodUsed
            } | ConvertTo-Json -Depth 3 -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    "set-text" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            [UiWin32]::SetForegroundWindow([IntPtr]$Hwnd)
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)

            $editCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
            $elements = $rootElem.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
            $target = $null
            foreach ($el in $elements) {
                try {
                    $name = $el.Current.Name
                    $autoId = $el.Current.AutomationId
                    if (-not $NamePattern -and -not $AutomationId) {
                        # Si no se especifica, toma el primer campo editable
                        $target = $el
                        break
                    }
                    if ($NamePattern -and $name -and ($name -like "*$NamePattern*" -or $name -match [regex]::Escape($NamePattern))) {
                        $target = $el
                        break
                    }
                    if ($AutomationId -and $autoId -and ($autoId -eq $AutomationId)) {
                        $target = $el
                        break
                    }
                } catch {}
            }

            if (-not $target) {
                Write-Output (@{ ok = $false; error = "Campo de texto '$NamePattern' no encontrado." } | ConvertTo-Json -Compress)
                exit 1
            }

            $methodUsed = "none"
            # 1. Intentar ValuePattern
            try {
                $valPattern = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($valPattern -and -not $valPattern.Current.IsReadOnly) {
                    $valPattern.SetValue($Text)
                    $methodUsed = "ValuePattern"
                }
            } catch {}

            # 2. Fallback a SetFocus + SendKeys
            if ($methodUsed -eq "none") {
                try {
                    $target.SetFocus()
                    Start-Sleep -Milliseconds 100
                    [System.Windows.Forms.SendKeys]::SendWait("^{A}")
                    [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
                    [System.Windows.Forms.SendKeys]::SendWait($Text)
                    $methodUsed = "SendKeysFallback"
                } catch {
                    # Si forms no está, usar portapapeles
                    Set-Clipboard -Value $Text
                    [System.Windows.Forms.SendKeys]::SendWait("^{v}")
                    $methodUsed = "ClipboardPasteFallback"
                }
            }

            Write-Output (@{
                ok = $true
                element = (Format-Element $target)
                method = $methodUsed
                textSet = $Text
            } | ConvertTo-Json -Depth 3 -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    "select-option" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            [UiWin32]::SetForegroundWindow([IntPtr]$Hwnd)
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
            
            # Buscar elementos tipo ListItem o TabItem o MenuItem con el texto
            $elements = $rootElem.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $target = $null
            foreach ($el in $elements) {
                try {
                    $name = $el.Current.Name
                    if ($name -and ($name -eq $Option -or $name -like "*$Option*" -or $name -match [regex]::Escape($Option))) {
                        $target = $el
                        break
                    }
                } catch {}
            }

            if (-not $target) {
                Write-Output (@{ ok = $false; error = "Opción '$Option' no encontrada." } | ConvertTo-Json -Compress)
                exit 1
            }

            $methodUsed = "none"
            try {
                $selPattern = $target.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if ($selPattern) {
                    $selPattern.Select()
                    $methodUsed = "SelectionItemPattern"
                }
            } catch {}

            if ($methodUsed -eq "none") {
                try {
                    $invokePattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    if ($invokePattern) {
                        $invokePattern.Invoke()
                        $methodUsed = "InvokePattern"
                    }
                } catch {}
            }

            if ($methodUsed -eq "none") {
                $rect = $target.Current.BoundingRectangle
                if ($rect.X -ne [double]::PositiveInfinity -and $rect.Width -gt 0) {
                    $cx = [int]($rect.X + ($rect.Width / 2))
                    $cy = [int]($rect.Y + ($rect.Height / 2))
                    [UiWin32]::SimulateClick($cx, $cy)
                    $methodUsed = "CoordinateFallback ($cx, $cy)"
                }
            }

            Write-Output (@{
                ok = $true
                element = (Format-Element $target)
                method = $methodUsed
                selectedOption = $Option
            } | ConvertTo-Json -Depth 3 -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    "get-text" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido o no especificado." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
            $condition = [System.Windows.Automation.Condition]::TrueCondition
            if ($ControlType -and $ControlType -ne "Any") {
                $typeField = [System.Windows.Automation.ControlType].GetField($ControlType)
                if ($typeField) {
                    $cType = $typeField.GetValue($null)
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $cType)
                }
            }

            $elements = $rootElem.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            $target = $null
            foreach ($el in $elements) {
                try {
                    $name = $el.Current.Name
                    $autoId = $el.Current.AutomationId
                    if (-not $NamePattern -and -not $AutomationId) {
                        $target = $el
                        break
                    }
                    if ($NamePattern -and $name -and ($name -like "*$NamePattern*" -or $name -match [regex]::Escape($NamePattern))) {
                        $target = $el
                        break
                    }
                    if ($AutomationId -and $autoId -and ($autoId -eq $AutomationId)) {
                        $target = $el
                        break
                    }
                } catch {}
            }

            if (-not $target) {
                Write-Output (@{ ok = $false; error = "Elemento no encontrado para lectura de texto." } | ConvertTo-Json -Compress)
                exit 1
            }

            $extractedText = ""
            try {
                $vp = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) { $extractedText = $vp.Current.Value }
            } catch {}

            if (-not $extractedText) {
                try {
                    $tp = $target.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
                    if ($tp) { $extractedText = $tp.DocumentRange.GetText(-1) }
                } catch {}
            }

            if (-not $extractedText) {
                $extractedText = $target.Current.Name
            }

            Write-Output (@{
                ok = $true
                text = $extractedText
                element = (Format-Element $target)
            } | ConvertTo-Json -Depth 3 -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    "close-window" {
        Ensure-Desktop
        if ($Hwnd -le 0) {
            Write-Output (@{ ok = $false; error = "Hwnd inválido o no especificado." } | ConvertTo-Json -Compress)
            exit 1
        }
        try {
            $rootElem = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
            $closed = $false
            try {
                $winPattern = $rootElem.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
                if ($winPattern) {
                    $winPattern.Close()
                    $closed = $true
                }
            } catch {}

            if (-not $closed) {
                [UiWin32]::PostMessage([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
                $closed = $true
            }

            Write-Output (@{ ok = $true; closed = $true; hwnd = $Hwnd } | ConvertTo-Json -Compress)
            exit 0
        } catch {
            Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
            exit 1
        }
    }

    default {
        Write-Output (@{ ok = $false; error = "Acción desconocida: '$Action'." } | ConvertTo-Json -Compress)
        exit 1
    }
}
