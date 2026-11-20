Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type 'using System; using System.Runtime.InteropServices; public class TestWindowVisibility { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command); }'

$form = New-Object System.Windows.Forms.Form
$form.Text = "JARVIS_TEST_WINDOW"
$form.Width = 400
$form.Height = 250
$form.StartPosition = "CenterScreen"

$btn = New-Object System.Windows.Forms.Button
$btn.Text = "Aceptar"
$btn.Name = "btnAceptar"
$btn.Width = 100
$btn.Height = 40
$btn.Location = New-Object System.Drawing.Point(50, 30)
$btn.Add_Click({ 
    $form.Tag = "CLICKED"
    $form.Close() 
})

$txt = New-Object System.Windows.Forms.TextBox
$txt.Name = "txtInput"
$txt.Text = "INITIAL_VALUE"
$txt.Location = New-Object System.Drawing.Point(50, 90)
$txt.Width = 250

$form.Controls.Add($btn)
$form.Controls.Add($txt)
$form.Add_Shown({ [TestWindowVisibility]::ShowWindow($form.Handle, 5) | Out-Null; [Console]::WriteLine("TEST_READY hwnd=$($form.Handle) visible=$($form.Visible)") })

[System.Windows.Forms.Application]::Run($form)
