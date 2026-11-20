using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Web.Script.Serialization;
using System.Windows.Interop;
using System.Runtime.InteropServices;

namespace JarvisDesktop {
    public class Companion : Window {
        private readonly HttpClient client;
        private readonly DispatcherTimer timer;
        private readonly TextBlock title, message;
        private readonly FrameworkElement character;
        private readonly Image fallbackImage;
        private readonly RigCharacter rig;
        private readonly TranslateTransform motion = new TranslateTransform();
        private readonly string endpoint, home;
        private readonly string logPath;
        private bool fetching, shuttingDown, animating, dismissed;
        private int failures, revision = -1, dismissedRevision = -1;
        private string currentState = "idle";
        private readonly BitmapSource[] poses = new BitmapSource[6];
        private int pose = -1, idleStep;
        private DateTime poseAt = DateTime.MinValue;
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);

        public Companion(int port, string token, string asset) {
            Title = "Jarvis · Personaje de escritorio";
            logPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(asset), "../../logs/desktop-companion-native.log"));
            Width = 310; Height = 440; WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize; AllowsTransparency = true;
            Background = Brushes.Transparent; ShowInTaskbar = false; ShowActivated = false; Topmost = true;
            home = "http://localhost:" + port + "/";
            endpoint = "http://127.0.0.1:" + port + "/api/companion/state";
            client = new HttpClient(new HttpClientHandler { UseProxy = false });
            client.Timeout = TimeSpan.FromSeconds(3);
            client.DefaultRequestHeaders.Add("X-Jarvis-Companion", token);
            var root = new Grid { Margin = new Thickness(6) };
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(174) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var bubble = new Border { Background = ColorBrush("#121214"), BorderBrush = ColorBrush("#C41E36"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(17), Padding = new Thickness(15, 11, 12, 12), Margin = new Thickness(0, 0, 0, 10) };
            var content = new DockPanel();
            var head = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
            var hide = new Button { Content = "×", Width = 23, Height = 23, Background = Brushes.Transparent, Foreground = Brushes.WhiteSmoke, BorderThickness = new Thickness(0), ToolTip = "Ocultar hasta la próxima tarea o hasta volver a minimizar Jarvis" };
            hide.Click += delegate { Dismiss(); }; DockPanel.SetDock(hide, Dock.Right); head.Children.Add(hide);
            title = new TextBlock { Text = "Jarvis está acá", FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = ColorBrush("#FF8D94"), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            head.Children.Add(title); DockPanel.SetDock(head, Dock.Top); content.Children.Add(head);
            var reply = new Button { Content = "Volver a Jarvis / responder", Background = ColorBrush("#A81930"), Foreground = Brushes.WhiteSmoke, Margin = new Thickness(0,8,0,0), Padding = new Thickness(5), BorderThickness = new Thickness(0) };
            reply.Click += delegate { OpenJarvis(); }; DockPanel.SetDock(reply, Dock.Bottom); content.Children.Add(reply);
            message = new TextBlock { Text = "Cuando me pidas algo, te aviso cómo va.", FontSize = 13, TextWrapping = TextWrapping.Wrap, Foreground = ColorBrush("#F4F1F2"), LineHeight = 18 };
            var scroll = new ScrollViewer { Content = message, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            content.Children.Add(scroll); bubble.Child = content; root.Children.Add(bubble);
            fallbackImage = new Image { Stretch = Stretch.Uniform };
            var rigPath=Path.Combine(Path.GetDirectoryName(asset),"jarvis-rig.json");
            if(File.Exists(rigPath)) { try { rig=new RigCharacter(rigPath); } catch(Exception error) { Log("Rig fallback: "+error.Message); } }
            character=rig!=null?(FrameworkElement)rig:fallbackImage;
            character.Margin=new Thickness(35,5,5,7);character.RenderTransform=motion;character.Cursor=Cursors.SizeAll;
            character.ToolTip="Arrastrame para moverme · Clic derecho para opciones";
            var sheetPath = Path.Combine(Path.GetDirectoryName(asset), "jarvis-poses.png");
            if(rig==null) {
                var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.UriSource = new Uri(asset); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.DecodePixelHeight = 500; bitmap.EndInit(); bitmap.Freeze();fallbackImage.Source=bitmap;
            }
            if (rig==null && File.Exists(sheetPath)) {
                var sheet = new BitmapImage(); sheet.BeginInit(); sheet.UriSource = new Uri(sheetPath); sheet.CacheOption = BitmapCacheOption.OnLoad; sheet.EndInit(); sheet.Freeze();
                int w = sheet.PixelWidth / 3, h = sheet.PixelHeight / 2;
                for (int i=0;i<6;i++) { var frame = new CroppedBitmap(sheet,new Int32Rect((i%3)*w,(i/3)*h,w,h)); frame.Freeze(); poses[i]=frame; }
            }
            RenderOptions.SetBitmapScalingMode(character, BitmapScalingMode.HighQuality);
            Grid.SetRow(character, 1); root.Children.Add(character); Content = root;
            character.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
                if (e.ClickCount == 2) { OpenJarvis(); return; }
                try { DragMove(); ClampPosition(); } catch (InvalidOperationException) {}
            };
            var menu = new ContextMenu();
            var open = new MenuItem { Header = "Abrir Jarvis" }; open.Click += delegate { OpenJarvis(); }; menu.Items.Add(open);
            var close = new MenuItem { Header = "Ocultar por ahora" }; close.Click += delegate { Dismiss(); }; menu.Items.Add(close);
            character.ContextMenu = menu;
            var area = SystemParameters.WorkArea; Left = area.Right - Width - 20; Top = area.Bottom - Height - 12;
            timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1000) };
            timer.Tick += async delegate {
                if (fetching || shuttingDown) return;
                fetching = true;
                try {
                    var json = await client.GetStringAsync(endpoint);
                    var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                    failures = 0; Apply(data);
                } catch (Exception error) {
                    if (failures == 0) Log("Connection error: " + error.Message);
                    if (!shuttingDown && ++failures >= 4) Close();
                } finally { fetching = false; }
            };
            Closed += delegate { shuttingDown = true; timer.Stop(); SetAnimation(false); client.Dispose(); };
            Log("Native companion initialized");
        }
        private void Log(string value) { try { File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + value + Environment.NewLine); } catch (IOException) {} }
        private static SolidColorBrush ColorBrush(string color) { var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(color); brush.Freeze(); return brush; }
        private void Dismiss() { dismissed = true; dismissedRevision = revision; Hide(); SetAnimation(false); }
        private void OpenJarvis() { var desktop=Environment.GetEnvironmentVariable("JARVIS_DESKTOP_EXE");Process.Start(new ProcessStartInfo(!String.IsNullOrEmpty(desktop)&&File.Exists(desktop)?desktop:home) { UseShellExecute = true }); Dismiss(); }
        private void ClampPosition() {
            // Keep the companion reachable within the Windows virtual desktop.
            Left = Math.Max(SystemParameters.VirtualScreenLeft, Math.Min(Left, SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - Width));
            Top = Math.Max(SystemParameters.VirtualScreenTop, Math.Min(Top, SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - Height));
        }
        private void SetPose(int next) {
            if (pose == next) return;
            pose=next; poseAt=DateTime.UtcNow;
            if(rig!=null) { string[] names={"wave","sit","exercise","working","celebrate","question","walk","idle"};rig.SetAnimation(names[next]);rig.SetRunning(true);return; }
            if (poses[next%6] != null) fallbackImage.Source=poses[next%6];
            motion.BeginAnimation(TranslateTransform.YProperty,null);
            animating=false;
            if (!SystemParameters.ClientAreaAnimation) return;
            double height=next==4 ? -13 : next==2 ? -6 : next==3 ? -2 : -3;
            var animation=new DoubleAnimation(0,height,TimeSpan.FromMilliseconds(next==3 ? 180 : 600)) {AutoReverse=true, RepeatBehavior=next==4 ? new RepeatBehavior(3) : RepeatBehavior.Forever};
            Timeline.SetDesiredFrameRate(animation,12); motion.BeginAnimation(TranslateTransform.YProperty,animation); animating=true;
        }
        private void SetAnimation(bool working) {
            if(rig!=null) { rig.SetRunning(working);return; }
            working = working && SystemParameters.ClientAreaAnimation;
            if (animating == working) return;
            animating = working;
            if (working) {
                var animation = new DoubleAnimation(-3, 3, TimeSpan.FromMilliseconds(650)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever };
                Timeline.SetDesiredFrameRate(animation, 12);
                motion.BeginAnimation(TranslateTransform.YProperty, animation);
            } else { motion.BeginAnimation(TranslateTransform.YProperty, null); motion.Y = 0; }
        }
        private void Apply(Dictionary<string, object> data) {
            if (shuttingDown) return;
            if(rig!=null)rig.SetMotionEnabled(!data.ContainsKey("animations") || Convert.ToBoolean(data["animations"]));
            if (!Convert.ToBoolean(data["enabled"])) { Close(); return; }
            var visible = Convert.ToBoolean(data["visible"]);
            var nextRevision = Convert.ToInt32(data["revision"]);
            if (!visible) dismissed = false;
            if (nextRevision != dismissedRevision) dismissed = false;
            if (nextRevision != revision) {
                revision = nextRevision; currentState = Convert.ToString(data["state"]);
                Log("State: " + currentState);
                title.Text = Convert.ToString(data["title"]); message.Text = Convert.ToString(data["text"]);
                title.Foreground = ColorBrush(currentState == "failed" ? "#FFB0B8" : currentState == "waiting" ? "#F4D68A" : "#FF8D94");
            }
            if (visible && !dismissed) { if (!IsVisible) { ClampPosition(); Show(); ShowWindow(new WindowInteropHelper(this).Handle,4); pose=-1; Log("Shown: " + currentState); } }
            else if (IsVisible) { Hide(); Log("Hidden: interface visible"); }
            if (!IsVisible) { SetAnimation(false); pose=-1; return; }
            if(rig!=null)rig.SetTalking(data.ContainsKey("speaking") && Convert.ToBoolean(data["speaking"]));
            if (currentState=="working") SetPose(3);
            else if (currentState=="waiting" || currentState=="failed") SetPose(5);
            else if ((currentState=="completed" || currentState=="reply") && DateTime.UtcNow.Subtract(new DateTime(1970,1,1)).TotalMilliseconds - Convert.ToDouble(data["at"]) < 8000) SetPose(4);
            else if (pose<0 || DateTime.UtcNow.Subtract(poseAt).TotalSeconds>12) { int[] idle={0,7,6,1,2,7}; SetPose(idle[(idleStep++)%idle.Length]); }
        }
        public static void Run(int port, string token, string asset) {
            bool created;
            using (var mutex = new Mutex(true, "Local\\JarvisDesktopCompanion_" + port, out created)) {
                if (!created) return;
                try {
                    var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                    var window = new Companion(port, token, asset);
                    window.Closed += delegate { app.Shutdown(); };
                    window.timer.Start(); app.Run();
                } finally { mutex.ReleaseMutex(); }
            }
        }
        public static void RenderTest(string asset, string output) {
            var window = new Companion(3000, "test", asset);
            var data = new Dictionary<string, object> { {"enabled",true}, {"visible",false}, {"revision",1}, {"state","completed"}, {"at",0}, {"title","Listo, jefe"}, {"text","Prueba visual: terminé el documento. Podés volver a Jarvis para ver el resultado."} };
            window.Apply(data);
            if(window.rig!=null) { window.rig.SetAnimation("working");window.rig.Seek(.25); }
            else if (window.poses[3]!=null) window.fallbackImage.Source=window.poses[3];
            var root = (FrameworkElement)window.Content;
            root.Measure(new Size(310,440)); root.Arrange(new Rect(0,0,310,440)); root.UpdateLayout();
            var image = new RenderTargetBitmap(310,440,96,96,PixelFormats.Pbgra32); image.Render(root);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
            using (var stream = File.Create(output)) encoder.Save(stream);
            window.client.Dispose();
        }
    }
}
