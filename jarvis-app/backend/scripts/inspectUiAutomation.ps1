Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$result = @{
    focused = @{}
    windows = @()
    activeWindowText = @()
}

try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($focused) {
        $result.focused = @{
            name = $focused.Current.Name
            controlType = $focused.Current.ControlType.ProgrammaticName
            processId = $focused.Current.ProcessId
            className = $focused.Current.ClassName
        }
    }
} catch {
    $result.focused = @{ error = $_.Exception.Message }
}

try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.Condition]::TrueCondition
    $topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    foreach ($w in $topWindows) {
        if ($w.Current.Name -and -not $w.Current.IsOffscreen) {
            $result.windows += @{
                name = $w.Current.Name
                processId = $w.Current.ProcessId
                className = $w.Current.ClassName
            }
        }
    }
} catch {
    $result.windowsError = $_.Exception.Message
}

Write-Output ($result | ConvertTo-Json -Depth 4 -Compress)
