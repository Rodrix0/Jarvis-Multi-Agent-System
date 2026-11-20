using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace JarvisDesktopApp {
    internal static class Program {
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string title);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
        [STAThread] static int Main(string[] args) {
            bool created;
            using(var mutex=new Mutex(true,"Local\\Rodrigo.Jarvis.Desktop.1",out created)) {
                if(!created){var window=FindWindow(null,"Jarvis");if(window!=IntPtr.Zero){ShowWindow(window,9);SetForegroundWindow(window);}return 0;}
                SetCurrentProcessExplicitAppUserModelID("Rodrigo.Jarvis.Desktop");
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainWindow(Array.IndexOf(args,"--self-test")>=0));
                mutex.ReleaseMutex();return Environment.ExitCode;
            }
        }
    }
    internal sealed class MainWindow:Form {
        readonly string root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        readonly string user=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Jarvis");
        readonly string token=Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");
        readonly HttpClient http=new HttpClient(new HttpClientHandler {UseProxy=false}) {Timeout=TimeSpan.FromSeconds(3)};
        readonly List<Process> services=new List<Process>();readonly object logLock=new object();
        readonly Label status=new Label();readonly WebView2 web=new WebView2();readonly NotifyIcon tray=new NotifyIcon();
        readonly bool selfTest;bool closing,allowClose,ready;Dictionary<string,object> config=new Dictionary<string,object>();
        const string Home="http://127.0.0.1:3000";
        public MainWindow(bool test) {
            selfTest=test;Directory.CreateDirectory(Path.Combine(user,"logs"));
            Text="Jarvis";Width=1280;Height=900;MinimumSize=new Size(390,640);StartPosition=FormStartPosition.CenterScreen;
            BackColor=Color.FromArgb(12,12,14);ForeColor=Color.White;Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            status.Text="Preparando Jarvis…";status.Dock=DockStyle.Bottom;status.Height=30;status.Padding=new Padding(15,6,0,0);status.BackColor=Color.FromArgb(28,16,21);status.ForeColor=Color.FromArgb(255,141,148);
            web.Dock=DockStyle.Fill;web.DefaultBackgroundColor=BackColor;Controls.Add(web);Controls.Add(status);
            tray.Icon=Icon;tray.Text="Jarvis · asistente personal";
            var menu=new ContextMenuStrip();menu.Items.Add("Abrir Jarvis",null,delegate{RestoreWindow();});
            menu.Items.Add("Poner en reposo",null,async delegate{await Post("/api/voice/local/state","{\"state\":\"dormant\"}");});
            menu.Items.Add("Salir de Jarvis",null,delegate{Close();});tray.ContextMenuStrip=menu;tray.DoubleClick+=delegate{RestoreWindow();};tray.Visible=true;
            Resize+=async delegate{if(ready)await NotifyVisibility();};Shown+=async delegate{await StartAsync();};
            FormClosing+=async delegate(object sender,FormClosingEventArgs e){
                if(allowClose)return;e.Cancel=true;if(closing)return;closing=true;status.Visible=true;status.Text="Cerrando Jarvis…";tray.Visible=false;
                await StopServices();allowClose=true;Close();
            };
            FormClosed+=delegate{tray.Dispose();web.Dispose();http.Dispose();};
        }
        void RestoreWindow(){Show();WindowState=FormWindowState.Normal;Activate();}
        void Log(string value){lock(logLock)File.AppendAllText(Path.Combine(user,"logs","desktop.log"),DateTime.Now.ToString("s")+" "+value+Environment.NewLine);}
        Process StartService(string name,string executable,string arguments,string cwd) {
            if(!File.Exists(executable))throw new FileNotFoundException("Falta el motor "+name,executable);
            var info=new ProcessStartInfo(executable,arguments) {WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
            info.StandardOutputEncoding=Encoding.UTF8;info.StandardErrorEncoding=Encoding.UTF8;
            info.EnvironmentVariables["PYTHONUTF8"]="1";info.EnvironmentVariables["PYTHONIOENCODING"]="utf-8";
            info.EnvironmentVariables.Remove("PYTHONHOME");info.EnvironmentVariables.Remove("PYTHONPATH");info.EnvironmentVariables["PYTHONNOUSERSITE"]="1";
            info.EnvironmentVariables["PATH"]=Path.Combine(root,"runtime","python-general")+";"+Path.Combine(root,"runtime","python-general","Scripts")+";"+Path.Combine(root,"runtime")+";"+Path.Combine(root,"app","backend","node_modules","ffmpeg-static")+";"+info.EnvironmentVariables["PATH"];
            info.EnvironmentVariables["JARVIS_PYTHON_EXE"]=Path.Combine(root,"runtime","python-general","python.exe");
            info.EnvironmentVariables["JARVIS_DATA_DIR"]=Path.Combine(user,"data");
            info.EnvironmentVariables["JARVIS_NODE_URL"]=Home;info.EnvironmentVariables["PORT"]="3000";info.EnvironmentVariables["JARVIS_BIND_HOST"]="127.0.0.1";
            info.EnvironmentVariables["JARVIS_DESKTOP_TOKEN"]=token;
            info.EnvironmentVariables["JARVIS_DESKTOP_EXE"]=Application.ExecutablePath;
            var chrome=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe");
            if(File.Exists(chrome))info.EnvironmentVariables["PUPPETEER_EXECUTABLE_PATH"]=chrome;
            info.EnvironmentVariables["JARVIS_SUPERTONIC_PYTHON"]=Path.Combine(root,"runtime","python-tts","python.exe");
            info.EnvironmentVariables["JARVIS_SUPERTONIC_MODEL_DIR"]=Path.Combine(root,"runtime","supertonic-3");
            info.EnvironmentVariables["JARVIS_TTS_ENGINE"]="supertonic3";
            info.EnvironmentVariables["DOTENV_CONFIG_PATH"]=Path.Combine(user,"settings","backend.env");
            if(config.ContainsKey("forgeBat"))info.EnvironmentVariables["JARVIS_FORGE_BAT"]=Convert.ToString(config["forgeBat"]);
            var process=new Process {StartInfo=info,EnableRaisingEvents=true};
            process.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)Log(name+": "+e.Data);};
            process.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)Log(name+": "+e.Data);};
            process.Start();services.Add(process);process.BeginOutputReadLine();process.BeginErrorReadLine();Log("Started "+name+" PID "+process.Id);return process;
        }
        async Task<Dictionary<string,object>> Get(string url){try{var text=await http.GetStringAsync(url);return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(text);}catch{return null;}}
        async Task Post(string path,string json){try{using(var content=new StringContent(json,Encoding.UTF8,"application/json"))await http.PostAsync(Home+path,content);}catch{}}
        async Task Wait(string url,int seconds){var deadline=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<deadline&&!closing){if(await Get(url)!=null)return;await Task.Delay(350);}throw new Exception("No respondió el motor local: "+url);}
        async Task StartAsync() {
            try {
                var configFile=Path.Combine(user,"desktop.json");if(File.Exists(configFile))config=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(configFile));
                if(await Get(Home+"/api/desktop/health")!=null||await Get(Home+"/api/voice/settings")!=null)throw new Exception("Hay otra sesión de Jarvis abierta. Cerrala antes de abrir la aplicación instalada.");
                File.WriteAllText(Path.Combine(user,"data","local_voice_state.json"),"{\"state\":\"dormant\",\"updatedAt\":0}");
                StartService("backend",Path.Combine(root,"runtime","node.exe"),"-r dotenv/config server.js",Path.Combine(root,"app","backend"));
                await Wait(Home+"/api/desktop/health",30);
                var health=await Get(Home+"/api/desktop/health");
                if(!String.Equals(Convert.ToString(health["root"]).TrimEnd('\\'),Path.Combine(root,"app","backend"),StringComparison.OrdinalIgnoreCase))throw new Exception("El puerto pertenece a otra instalación.");
                var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(user,"browser"));
                await web.EnsureCoreWebView2Async(env);
                web.CoreWebView2.Settings.AreDevToolsEnabled=false;web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
                web.CoreWebView2.NavigationStarting+=delegate(object sender,CoreWebView2NavigationStartingEventArgs e){if(!LocalUri(e.Uri)){e.Cancel=true;if(e.IsUserInitiated)OpenLink(e.Uri);}};
                web.CoreWebView2.NewWindowRequested+=delegate(object sender,CoreWebView2NewWindowRequestedEventArgs e){e.Handled=true;if(e.IsUserInitiated)OpenLink(e.Uri);};
                web.CoreWebView2.PermissionRequested+=delegate(object sender,CoreWebView2PermissionRequestedEventArgs e){if(LocalUri(e.Uri)&&e.IsUserInitiated&&e.PermissionKind==CoreWebView2PermissionKind.Microphone)e.State=CoreWebView2PermissionState.Allow;};
                web.CoreWebView2.DOMContentLoaded+=async delegate{await NotifyVisibility();};
                web.CoreWebView2.Navigate(Home+"/");ready=true;
                var general=StartService("python",Path.Combine(root,"runtime","python-general","python.exe"),"-m uvicorn main:app --host 127.0.0.1 --port 8000",Path.Combine(root,"app","python_engine"));
                var voice=StartService("voz",Path.Combine(root,"runtime","python-voice","python.exe"),"\""+Path.Combine(root,"app","python_engine","voice_assistant.py")+"\"",Path.Combine(root,"app"));
                var ollamaTask=EnsureOllama();
                status.Text="Preparando la voz local…";
                var deadline=DateTime.UtcNow.AddSeconds(55);bool voiceReady=false;
                while(DateTime.UtcNow<deadline&&!closing){var v=await Get(Home+"/api/voice/local/status");if(v!=null&&v.ContainsKey("online")&&Convert.ToBoolean(v["online"])){voiceReady=true;break;}if(voice.HasExited)break;await Task.Delay(400);}
                await ollamaTask;
                if(!voiceReady)throw new Exception("La voz local no pudo iniciarse. Revisá desktop.log en "+Path.Combine(user,"logs"));
                await Wait("http://127.0.0.1:8000/openapi.json",30);
                status.Visible=false;Log("Ready; local voice dormant");
                if(selfTest)await RunSelfTest();
            } catch(Exception error){
                Log("Startup failed: "+error);Environment.ExitCode=1;
                if(selfTest){File.WriteAllText(Path.Combine(user,"logs","self-test.json"),new JavaScriptSerializer().Serialize(new {ok=false,error=error.Message}));Close();}
                else{MessageBox.Show(error.Message,"Jarvis",MessageBoxButtons.OK,MessageBoxIcon.Error);Close();}
            }
        }
        async Task EnsureOllama(){
            if(await Get("http://127.0.0.1:11434/api/version")!=null)return;
            var exe=config.ContainsKey("ollamaExe")?Convert.ToString(config["ollamaExe"]):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Ollama","ollama.exe");
            if(File.Exists(exe)){Process.Start(new ProcessStartInfo(exe,"serve") {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(exe)});Log("Started shared Ollama service");}
        }
        bool LocalUri(string value){Uri uri;return Uri.TryCreate(value,UriKind.Absolute,out uri)&&uri.Scheme=="http"&&uri.Port==3000&&(uri.Host=="127.0.0.1"||uri.Host=="localhost");}
        void OpenLink(string value){Uri uri;if(Uri.TryCreate(value,UriKind.Absolute,out uri)&&(uri.Scheme=="http"||uri.Scheme=="https"))Process.Start(new ProcessStartInfo(value){UseShellExecute=true});}
        async Task NotifyVisibility(){if(web.CoreWebView2==null)return;try{bool visible=WindowState!=FormWindowState.Minimized;await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('jarvis-desktop-visibility',{detail:{visible:"+(visible?"true":"false")+"}}))");web.Visible=visible;}catch{}}
        async Task RunSelfTest(){
            bool ui=false;for(int i=0;i<40;i++){var result=await web.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('#main-assistant-status')&&document.querySelector('.assistant-presence')&&getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#ff525c')");if(result=="true"){ui=true;break;}await Task.Delay(250);}
            if(!ui)throw new Exception("La ventana no mostró la interfaz de Jarvis.");
            var voice=await Get(Home+"/api/voice/local/status");if(Convert.ToString(voice["state"])!="dormant")throw new Exception("La voz no inició en reposo.");
            using(var file=File.Create(Path.Combine(user,"logs","installed-window.png")))await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,file);
            File.WriteAllText(Path.Combine(user,"logs","self-test.json"),new JavaScriptSerializer().Serialize(new {ok=true,ui=true,voiceOnline=true,voiceState="dormant",version="1.0.0",installedRoot=root}));
            Log("Installed application self-test passed");Close();
        }
        async Task StopServices(){
            if(services.Count==0)return;
            try{using(var request=new HttpRequestMessage(HttpMethod.Post,Home+"/api/desktop/shutdown")){request.Headers.Add("X-Jarvis-Desktop",token);await http.SendAsync(request);}}catch{}
            await Task.Delay(500);
            foreach(var process in services){try{if(!process.HasExited){process.Kill();await Task.Run(()=>process.WaitForExit(3000));}process.Dispose();}catch(Exception error){Log("Shutdown: "+error.Message);}}
            Log("Owned Jarvis services closed");
        }
    }
}
