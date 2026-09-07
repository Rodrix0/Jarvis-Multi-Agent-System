param (
    [string]$Action = "list-windows",
    [string]$TitlePattern = "",
    [long]$Hwnd = 0,
    [string]$ControlType = "Any",
    [string]$NamePattern = "",
    [string]$AutomationId = "",
    [string]$Text = "",
    [string]$Option = "",
    [int]$X = -1,
    [int]$Y = -1,
    [int]$Width = -1,
    [int]$Height = -1,
    [int]$TimeoutMs = 5000
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$csharp = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

public class NativeBridge {
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumWindows(EnumWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP   = 0x0004;
    public const uint WM_CLOSE = 0x0010;

    public static string EscapeJson(string s) {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
    }

    public static string FormatElemJson(AutomationElement el) {
        if (el == null) return "null";
        try {
            var cur = el.Current;
            var r = cur.BoundingRectangle;
            bool hasCoords = (r.X != double.PositiveInfinity && r.Width > 0);
            string val = null;
            try {
                object vpObj;
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out vpObj)) {
                    val = ((ValuePattern)vpObj).Current.Value;
                }
            } catch {}

            string cType = cur.ControlType.ProgrammaticName.Replace("ControlType.", "");
            string boundsJson = hasCoords ? string.Format("{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3},\"centerX\":{4},\"centerY\":{5}}}",
                (int)r.X, (int)r.Y, (int)r.Width, (int)r.Height, (int)(r.X + r.Width/2), (int)(r.Y + r.Height/2)) : "null";

            return string.Format("{{\"name\":\"{0}\",\"value\":{1},\"automationId\":\"{2}\",\"controlType\":\"{3}\",\"className\":\"{4}\",\"isEnabled\":{5},\"isOffscreen\":{6},\"bounds\":{7}}}",
                EscapeJson(cur.Name), val == null ? "null" : ("\"" + EscapeJson(val) + "\""), EscapeJson(cur.AutomationId), cType, EscapeJson(cur.ClassName),
                cur.IsEnabled ? "true" : "false", cur.IsOffscreen ? "true" : "false", boundsJson);
        } catch {
            return "null";
        }
    }

    public static T RunInDesktop<T>(Func<T> action) {
        T result = default(T);
        Exception exOccurred = null;
        Thread t = new Thread(() => {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01ff);
            if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01ff);
            if (hDesk != IntPtr.Zero) {
                SetThreadDesktop(hDesk);
            }
            try {
                result = action();
            } catch (Exception ex) {
                exOccurred = ex;
            } finally {
                if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        if (exOccurred != null) throw exOccurred;
        return result;
    }

    public static string ListWindowsJson() {
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"windows\":[");
        bool first = true;

        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01ff);
        if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01ff);

        if (hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var titleBuf = new StringBuilder(512);
                    int len = GetWindowText(hWnd, titleBuf, 512);
                    if (len > 0) {
                        var classBuf = new StringBuilder(256);
                        GetClassName(hWnd, classBuf, 256);
                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        if (!first) sb.Append(",");
                        sb.AppendFormat("{{\"Hwnd\":{0},\"Title\":\"{1}\",\"ClassName\":\"{2}\",\"ProcessId\":{3}}}",
                            (long)hWnd, EscapeJson(titleBuf.ToString()), EscapeJson(classBuf.ToString()), pid);
                        first = false;
                    }
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        } else {
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var titleBuf = new StringBuilder(512);
                    int len = GetWindowText(hWnd, titleBuf, 512);
                    if (len > 0) {
                        var classBuf = new StringBuilder(256);
                        GetClassName(hWnd, classBuf, 256);
                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        if (!first) sb.Append(",");
                        sb.AppendFormat("{{\"Hwnd\":{0},\"Title\":\"{1}\",\"ClassName\":\"{2}\",\"ProcessId\":{3}}}",
                            (long)hWnd, EscapeJson(titleBuf.ToString()), EscapeJson(classBuf.ToString()), pid);
                        first = false;
                    }
                }
                return true;
            }, IntPtr.Zero);
        }
        sb.Append("]}");
        return sb.ToString();
    }

    public static string FindWindowJson(string pattern) {
        string clean = pattern ?? "";
        if (clean.StartsWith("/") && clean.Contains("/")) {
            var m = Regex.Match(clean, "^/(.+)/[a-z]*$");
            if (m.Success) clean = m.Groups[1].Value;
        }

        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01ff);
        if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01ff);

        var matched = new List<string>();
        if (hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var titleBuf = new StringBuilder(512);
                    int len = GetWindowText(hWnd, titleBuf, 512);
                    if (len > 0) {
                        string title = titleBuf.ToString();
                        bool isMatch = false;
                        if (string.IsNullOrEmpty(clean)) isMatch = true;
                        else {
                            try {
                                if (Regex.IsMatch(title, clean, RegexOptions.IgnoreCase)) isMatch = true;
                            } catch {
                                if (title.IndexOf(clean, StringComparison.OrdinalIgnoreCase) >= 0) isMatch = true;
                            }
                        }
                        if (isMatch) {
                            var classBuf = new StringBuilder(256);
                            GetClassName(hWnd, classBuf, 256);
                            uint pid;
                            GetWindowThreadProcessId(hWnd, out pid);
                            matched.Add(string.Format("{{\"Hwnd\":{0},\"Title\":\"{1}\",\"ClassName\":\"{2}\",\"ProcessId\":{3}}}",
                                (long)hWnd, EscapeJson(title), EscapeJson(classBuf.ToString()), pid));
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        }

        if (matched.Count > 0) {
            matched.Sort((a, b) => {
                bool aApp = a.Contains("\"ClassName\":\"ApplicationFrameWindow\"");
                bool bApp = b.Contains("\"ClassName\":\"ApplicationFrameWindow\"");
                if (aApp && !bApp) return -1;
                if (!aApp && bApp) return 1;
                return 0;
            });
            return string.Format("{{\"ok\":true,\"matched\":true,\"window\":{0},\"candidates\":[{1}]}}",
                matched[0], string.Join(",", matched.ToArray()));
        } else {
            return "{\"ok\":true,\"matched\":false,\"window\":null,\"candidates\":[]}";
        }
    }

    public static string FindElementsJson(long hwnd, string controlType, string namePattern, string autoId) {
        return RunInDesktop(() => {
            try {
                ShowWindow((IntPtr)hwnd, 9);
                SetForegroundWindow((IntPtr)hwnd);
                AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
                if (root == null) return "{\"ok\":true,\"count\":0,\"elements\":[]}";

                Condition cond = Condition.TrueCondition;
                if (!string.IsNullOrEmpty(controlType) && controlType != "Any") {
                    var f = typeof(ControlType).GetField(controlType);
                    if (f != null) cond = new PropertyCondition(AutomationElement.ControlTypeProperty, (ControlType)f.GetValue(null));
                }

                var elements = root.FindAll(TreeScope.Descendants, cond);
                var list = new List<string>();
                foreach (AutomationElement el in elements) {
                    try {
                        string name = el.Current.Name ?? "";
                        string aid = el.Current.AutomationId ?? "";
                        bool matchName = true;
                        if (!string.IsNullOrEmpty(namePattern)) {
                            matchName = (name.IndexOf(namePattern, StringComparison.OrdinalIgnoreCase) >= 0 || Regex.IsMatch(name, Regex.Escape(namePattern), RegexOptions.IgnoreCase));
                        }
                        bool matchId = true;
                        if (!string.IsNullOrEmpty(autoId)) {
                            matchId = (aid == autoId || aid.IndexOf(autoId, StringComparison.OrdinalIgnoreCase) >= 0);
                        }
                        if (matchName && matchId) {
                            string elemJson = FormatElemJson(el);
                            if (elemJson != "null") list.Add(elemJson);
                        }
                    } catch {}
                }

                return string.Format("{{\"ok\":true,\"count\":{0},\"elements\":[{1}]}}", list.Count, string.Join(",", list.ToArray()));
            } catch (ElementNotAvailableException) {
                return "{\"ok\":true,\"count\":0,\"elements\":[]}";
            } catch (Exception ex) {
                return string.Format("{{\"ok\":false,\"error\":\"{0}\"}}", EscapeJson(ex.Message));
            }
        });
    }

    public static string ClickElementJson(long hwnd, string namePattern, string autoId, string controlType) {
        return RunInDesktop(() => {
            try {
                ShowWindow((IntPtr)hwnd, 9);
                SetForegroundWindow((IntPtr)hwnd);
                AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
                if (root == null) return "{\"ok\":false,\"error\":\"Window not found\"}";

                Condition cond = Condition.TrueCondition;
                if (!string.IsNullOrEmpty(controlType) && controlType != "Any") {
                    var f = typeof(ControlType).GetField(controlType);
                    if (f != null) cond = new PropertyCondition(AutomationElement.ControlTypeProperty, (ControlType)f.GetValue(null));
                }

                var elements = root.FindAll(TreeScope.Descendants, cond);
                AutomationElement target = null;
                foreach (AutomationElement el in elements) {
                    try {
                        string name = el.Current.Name ?? "";
                        string aid = el.Current.AutomationId ?? "";
                        if (!string.IsNullOrEmpty(autoId) && aid == autoId) { target = el; break; }
                        if (!string.IsNullOrEmpty(namePattern) && (name.IndexOf(namePattern, StringComparison.OrdinalIgnoreCase) >= 0 || Regex.IsMatch(name, Regex.Escape(namePattern), RegexOptions.IgnoreCase))) {
                            target = el;
                            break;
                        }
                    } catch {}
                }

                if (target == null) return string.Format("{{\"ok\":false,\"error\":\"Element not found: name='{0}', id='{1}'\"}}", EscapeJson(namePattern), EscapeJson(autoId));

                string methodUsed = "none";
                object invObj;
                if (target.TryGetCurrentPattern(InvokePattern.Pattern, out invObj)) {
                    ((InvokePattern)invObj).Invoke();
                    methodUsed = "InvokePattern";
                } else {
                    object togObj;
                    if (target.TryGetCurrentPattern(TogglePattern.Pattern, out togObj)) {
                        ((TogglePattern)togObj).Toggle();
                        methodUsed = "TogglePattern";
                    } else {
                        var r = target.Current.BoundingRectangle;
                        if (r.X != double.PositiveInfinity && r.Width > 0) {
                            int cx = (int)(r.X + r.Width/2);
                            int cy = (int)(r.Y + r.Height/2);
                            SetCursorPos(cx, cy);
                            Thread.Sleep(50);
                            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                            Thread.Sleep(50);
                            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                            methodUsed = string.Format("CoordinateFallback ({0}, {1})", cx, cy);
                        }
                    }
                }

                return string.Format("{{\"ok\":true,\"element\":{0},\"method\":\"{1}\"}}", FormatElemJson(target), methodUsed);
            } catch (ElementNotAvailableException) {
                return "{\"ok\":false,\"error\":\"Element not available\"}";
            } catch (Exception ex) {
                return string.Format("{{\"ok\":false,\"error\":\"{0}\"}}", EscapeJson(ex.Message));
            }
        });
    }

    public static string GetTextJson(long hwnd, string namePattern, string autoId, string controlType) {
        return RunInDesktop(() => {
            try {
                ShowWindow((IntPtr)hwnd, 9);
                SetForegroundWindow((IntPtr)hwnd);
                AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
                if (root == null) return "{\"ok\":false,\"error\":\"Window not found\"}";

                Condition cond = Condition.TrueCondition;
                if (!string.IsNullOrEmpty(controlType) && controlType != "Any") {
                    var f = typeof(ControlType).GetField(controlType);
                    if (f != null) cond = new PropertyCondition(AutomationElement.ControlTypeProperty, (ControlType)f.GetValue(null));
                }

                var elements = root.FindAll(TreeScope.Descendants, cond);
                AutomationElement target = null;
                if (string.IsNullOrEmpty(namePattern) && string.IsNullOrEmpty(autoId)) {
                    // If controlType is Any, prefer Edit or Document if available
                    if (controlType == "Any" || string.IsNullOrEmpty(controlType)) {
                        foreach (AutomationElement el in elements) {
                            try {
                                string ct = el.Current.ControlType.ProgrammaticName;
                                if (ct.Contains("Edit") || ct.Contains("Document")) {
                                    target = el;
                                    break;
                                }
                            } catch {}
                        }
                    }
                    if (target == null && elements.Count > 0) target = elements[0];
                } else {
                    foreach (AutomationElement el in elements) {
                        try {
                            string name = el.Current.Name ?? "";
                            string aid = el.Current.AutomationId ?? "";
                            if (!string.IsNullOrEmpty(autoId) && aid == autoId) { target = el; break; }
                            if (!string.IsNullOrEmpty(namePattern) && (name.IndexOf(namePattern, StringComparison.OrdinalIgnoreCase) >= 0 || Regex.IsMatch(name, Regex.Escape(namePattern), RegexOptions.IgnoreCase))) {
                                target = el;
                                break;
                            }
                        } catch {}
                    }
                }

                if (target == null) return "{\"ok\":false,\"error\":\"Element not found for get-text\"}";

                string text = "";
                try {
                    object vpObj;
                    if (target.TryGetCurrentPattern(ValuePattern.Pattern, out vpObj)) text = ((ValuePattern)vpObj).Current.Value;
                } catch {}

                if (string.IsNullOrEmpty(text)) {
                    try {
                        object tpObj;
                        if (target.TryGetCurrentPattern(TextPattern.Pattern, out tpObj)) text = ((TextPattern)tpObj).DocumentRange.GetText(-1);
                    } catch {}
                }

                if (string.IsNullOrEmpty(text)) {
                    text = target.Current.Name ?? "";
                }

                return string.Format("{{\"ok\":true,\"text\":\"{0}\",\"element\":{1}}}", EscapeJson(text), FormatElemJson(target));
            } catch (ElementNotAvailableException) {
                return "{\"ok\":false,\"error\":\"Element not available\"}";
            } catch (Exception ex) {
                return string.Format("{{\"ok\":false,\"error\":\"{0}\"}}", EscapeJson(ex.Message));
            }
        });
    }

    public static string SetTextJson(long hwnd, string namePattern, string autoId, string text) {
        return RunInDesktop(() => {
            try {
                ShowWindow((IntPtr)hwnd, 9);
                SetForegroundWindow((IntPtr)hwnd);
                AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
                if (root == null) return "{\"ok\":false,\"error\":\"Window not found\"}";

                var orCond = new OrCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document)
                );

                var elements = root.FindAll(TreeScope.Descendants, orCond);
                AutomationElement target = null;
                if (string.IsNullOrEmpty(namePattern) && string.IsNullOrEmpty(autoId)) {
                    if (elements.Count > 0) target = elements[0];
                } else {
                    foreach (AutomationElement el in elements) {
                        try {
                            string name = el.Current.Name ?? "";
                            string aid = el.Current.AutomationId ?? "";
                            if (!string.IsNullOrEmpty(autoId) && aid == autoId) { target = el; break; }
                            if (!string.IsNullOrEmpty(namePattern) && (name.IndexOf(namePattern, StringComparison.OrdinalIgnoreCase) >= 0 || Regex.IsMatch(name, Regex.Escape(namePattern), RegexOptions.IgnoreCase))) {
                                target = el;
                                break;
                            }
                        } catch {}
                    }
                }

                if (target == null) return "{\"ok\":false,\"error\":\"Editable element not found\"}";

                string method = "none";
                try {
                    object vpObj;
                    if (target.TryGetCurrentPattern(ValuePattern.Pattern, out vpObj)) {
                        ((ValuePattern)vpObj).SetValue(text);
                        method = "ValuePattern";
                    }
                } catch {}

                if (method == "none") {
                    target.SetFocus();
                    Thread.Sleep(100);
                    System.Windows.Forms.SendKeys.SendWait("^{A}");
                    System.Windows.Forms.SendKeys.SendWait("{BACKSPACE}");
                    System.Windows.Forms.SendKeys.SendWait(text);
                    method = "SendKeysFallback";
                }

                return string.Format("{{\"ok\":true,\"method\":\"{0}\",\"textSet\":\"{1}\",\"element\":{2}}}",
                    method, EscapeJson(text), FormatElemJson(target));
            } catch (ElementNotAvailableException) {
                return "{\"ok\":false,\"error\":\"Element not available\"}";
            } catch (Exception ex) {
                return string.Format("{{\"ok\":false,\"error\":\"{0}\"}}", EscapeJson(ex.Message));
            }
        });
    }

    public static string CloseWindowJson(long hwnd) {
        return RunInDesktop(() => {
            bool closed = false;
            try {
                AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
                if (root != null) {
                    object wpObj;
                    if (root.TryGetCurrentPattern(WindowPattern.Pattern, out wpObj)) {
                        ((WindowPattern)wpObj).Close();
                        closed = true;
                    }
                }
            } catch {}

            if (!closed) {
                PostMessage((IntPtr)hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                closed = true;
            }

            return string.Format("{{\"ok\":true,\"closed\":{0},\"hwnd\":{1}}}", closed ? "true" : "false", hwnd);
        });
    }

    public static string SelectOptionJson(long hwnd, string option) {
        return RunInDesktop(() => {
            SetForegroundWindow((IntPtr)hwnd);
            AutomationElement root = AutomationElement.FromHandle((IntPtr)hwnd);
            if (root == null) return "{\"ok\":false,\"error\":\"Window not found\"}";

            var elements = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            AutomationElement target = null;
            foreach (AutomationElement el in elements) {
                try {
                    string name = el.Current.Name ?? "";
                    if (!string.IsNullOrEmpty(name) && (name == option || name.IndexOf(option, StringComparison.OrdinalIgnoreCase) >= 0 || Regex.IsMatch(name, Regex.Escape(option), RegexOptions.IgnoreCase))) {
                        target = el;
                        break;
                    }
                } catch {}
            }

            if (target == null) return string.Format("{{\"ok\":false,\"error\":\"Option '{0}' not found\"}}", EscapeJson(option));

            string method = "none";
            object selObj;
            if (target.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selObj)) {
                ((SelectionItemPattern)selObj).Select();
                method = "SelectionItemPattern";
            } else {
                object invObj;
                if (target.TryGetCurrentPattern(InvokePattern.Pattern, out invObj)) {
                    ((InvokePattern)invObj).Invoke();
                    method = "InvokePattern";
                } else {
                    var r = target.Current.BoundingRectangle;
                    if (r.X != double.PositiveInfinity && r.Width > 0) {
                        int cx = (int)(r.X + r.Width/2);
                        int cy = (int)(r.Y + r.Height/2);
                        SetCursorPos(cx, cy);
                        Thread.Sleep(50);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(50);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                        method = string.Format("CoordinateFallback ({0}, {1})", cx, cy);
                    }
                }
            }

            return string.Format("{{\"ok\":true,\"method\":\"{0}\",\"selectedOption\":\"{1}\",\"element\":{2}}}",
                method, EscapeJson(option), FormatElemJson(target));
        });
    }

    public static string MoveWindowJson(long hwnd, int x, int y, int width, int height) {
        return RunInDesktop(() => {
            RECT r = new RECT();
            bool hasRect = GetWindowRect((IntPtr)hwnd, out r);
            int curW = hasRect ? (r.Right - r.Left) : 800;
            int curH = hasRect ? (r.Bottom - r.Top) : 600;
            int curX = hasRect ? r.Left : 100;
            int curY = hasRect ? r.Top : 100;

            int newX = x >= 0 ? x : curX;
            int newY = y >= 0 ? y : curY;
            int newW = width > 0 ? width : curW;
            int newH = height > 0 ? height : curH;

            bool moved = SetWindowPos((IntPtr)hwnd, IntPtr.Zero, newX, newY, newW, newH, SWP_NOZORDER | SWP_NOACTIVATE);
            return string.Format("{{\"ok\":true,\"moved\":{0},\"bounds\":{{\"x\":{1},\"y\":{2},\"width\":{3},\"height\":{4}}},\"hwnd\":{5}}}",
                moved ? "true" : "false", newX, newY, newW, newH, hwnd);
        });
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies "UIAutomationClient", "UIAutomationTypes", "WindowsBase", "System.Windows.Forms" -ErrorAction SilentlyContinue

switch ($Action.ToLower()) {
    "list-windows" {
        Write-Output ([NativeBridge]::ListWindowsJson())
        exit 0
    }
    "find-window" {
        Write-Output ([NativeBridge]::FindWindowJson($TitlePattern))
        exit 0
    }
    "find-elements" {
        Write-Output ([NativeBridge]::FindElementsJson($Hwnd, $ControlType, $NamePattern, $AutomationId))
        exit 0
    }
    "click-element" {
        Write-Output ([NativeBridge]::ClickElementJson($Hwnd, $NamePattern, $AutomationId, $ControlType))
        exit 0
    }
    "get-text" {
        Write-Output ([NativeBridge]::GetTextJson($Hwnd, $NamePattern, $AutomationId, $ControlType))
        exit 0
    }
    "set-text" {
        Write-Output ([NativeBridge]::SetTextJson($Hwnd, $NamePattern, $AutomationId, $Text))
        exit 0
    }
    "select-option" {
        Write-Output ([NativeBridge]::SelectOptionJson($Hwnd, $Option))
        exit 0
    }
    "close-window" {
        Write-Output ([NativeBridge]::CloseWindowJson($Hwnd))
        exit 0
    }
    "move-window" {
        Write-Output ([NativeBridge]::MoveWindowJson($Hwnd, $X, $Y, $Width, $Height))
        exit 0
    }
    default {
        Write-Output "{\"ok\":false,\"error\":\"Unknown action: $Action\"}"
        exit 1
    }
}
