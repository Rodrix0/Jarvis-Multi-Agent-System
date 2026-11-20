using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace JarvisInstaller {
    internal static class Program {
        const string Product="Rodrigo.Jarvis.Desktop.1";
        const string ExpectedHash="__PAYLOAD_HASH__";
        const string Package="Jarvis-1.0.0.zip";
        const string RegistryPath=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JarvisDesktop";
        static string InstallRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Jarvis");
        static string UserRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Jarvis");
        [STAThread] static int Main(string[] args) {
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            bool silent=Array.IndexOf(args,"--silent")>=0;
            if(Array.IndexOf(args,"--uninstall")>=0||Path.GetFileNameWithoutExtension(Application.ExecutablePath)=="JarvisUninstall")return Uninstall(silent);
            string source=null;int index=Array.IndexOf(args,"--migrate-from");if(index>=0&&index+1<args.Length)source=Path.GetFullPath(args[index+1]);
            if(silent){try{Install(source,delegate{});return 0;}catch(Exception error){WriteResult(false,error.Message);return 1;}}
            var form=new Form { Text="Instalar Jarvis",Width=550,Height=280,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,BackColor=Color.FromArgb(15,15,18),ForeColor=Color.White };
            var title=new Label {Text="JARVIS · Aplicación de escritorio",Left=25,Top=25,Width=480,Height=30,Font=new Font("Segoe UI",16,FontStyle.Bold)};
            var text=new Label {Text="Se instalará para tu usuario, con acceso en el escritorio y el menú Inicio.\nLos datos personales se conservan por separado.",Left=25,Top=70,Width=480,Height=55};
            var progress=new ProgressBar {Left=25,Top=140,Width=480,Height=18};
            var button=new Button {Text="Instalar",Left=365,Top=180,Width=140,Height=35,BackColor=Color.FromArgb(196,30,54),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
            bool installing=false;
            button.Click+=async delegate {if(installing)return;installing=true;button.Enabled=false;
                try {await Task.Run(()=>Install(source,(percent,message)=>form.BeginInvoke((Action)delegate{progress.Value=Math.Max(0,Math.Min(100,percent));text.Text=message;})));text.Text="Jarvis está instalado. Podés abrirlo desde el escritorio.";button.Text="Abrir Jarvis";button.Enabled=true;button.Click+=delegate{Process.Start(Path.Combine(InstallRoot,"Jarvis.exe"));form.Close();};}
                catch(Exception error){text.Text="No se completó la instalación: "+error.Message;button.Text="Cerrar";button.Enabled=true;button.Click+=delegate{form.Close();};}
            };
            form.FormClosing+=delegate(object sender,FormClosingEventArgs e){if(installing&&!button.Enabled)e.Cancel=true;};
            form.Controls.AddRange(new Control[]{title,text,progress,button});Application.Run(form);return 0;
        }
        static void WriteResult(bool ok,string message){Directory.CreateDirectory(Path.Combine(UserRoot,"logs"));File.WriteAllText(Path.Combine(UserRoot,"logs","install-result.json"),new JavaScriptSerializer().Serialize(new{ok,message,installRoot=InstallRoot,version="1.0.0"}));}
        static void Install(string source,Action<int,string> report) {
            var package=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,Package);
            if(!File.Exists(package))throw new Exception("Colocá "+Package+" junto al instalador.");
            if(Directory.Exists(InstallRoot)&&Directory.GetFileSystemEntries(InstallRoot).Length>0&&!OwnInstall())throw new Exception("La carpeta Jarvis ya existe y no pertenece a este instalador.");
            foreach(var process in Process.GetProcessesByName("Jarvis")){try{if(String.Equals(process.MainModule.FileName,Path.Combine(InstallRoot,"Jarvis.exe"),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Cerrá Jarvis antes de reinstalar.");}catch(System.ComponentModel.Win32Exception){}}
            report(0,"Verificando el paquete…");
            using(var sha=SHA256.Create())using(var file=File.OpenRead(package)){var hash=BitConverter.ToString(sha.ComputeHash(file)).Replace("-","").ToLowerInvariant();if(hash!=ExpectedHash)throw new Exception("El paquete está incompleto o fue modificado.");}
            Directory.CreateDirectory(InstallRoot);File.WriteAllText(Path.Combine(InstallRoot,"jarvis.install.json"),new JavaScriptSerializer().Serialize(new{product=Product,version="1.0.0"}));
            var root=Path.GetFullPath(InstallRoot)+Path.DirectorySeparatorChar;
            using(var zip=ZipFile.OpenRead(package)) {
                long total=0;foreach(var entry in zip.Entries)total+=entry.Length;
                if(new DriveInfo(Path.GetPathRoot(root)).AvailableFreeSpace<total+500*1024*1024)throw new Exception("No hay espacio suficiente para instalar Jarvis.");
                long done=0;int last=-1;
                foreach(var entry in zip.Entries) {
                    string target=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                    if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new Exception("Ruta inválida dentro del paquete.");
                    if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}
                    Directory.CreateDirectory(Path.GetDirectoryName(target));using(var input=entry.Open())using(var output=File.Create(target))input.CopyTo(output);
                    done+=entry.Length;int percent=(int)(done*90/Math.Max(1,total));if(percent!=last){last=percent;report(percent,"Instalando Jarvis y sus motores locales… "+percent+"%");}
                }
            }
            using(var patch=Assembly.GetExecutingAssembly().GetManifestResourceStream("Jarvis.Patch"))if(patch!=null)using(var zip=new ZipArchive(patch,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
                string target=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new Exception("Ruta inválida en la actualización de interfaz.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));using(var input=entry.Open())using(var output=File.Create(target))input.CopyTo(output);
            }
            report(92,"Conservando datos y configurando los accesos…");
            Directory.CreateDirectory(UserRoot);Directory.CreateDirectory(Path.Combine(UserRoot,"data"));Directory.CreateDirectory(Path.Combine(UserRoot,"settings"));Directory.CreateDirectory(Path.Combine(UserRoot,"logs"));Directory.CreateDirectory(Path.Combine(UserRoot,"python-data"));
            if(source!=null&&!File.Exists(Path.Combine(UserRoot,".migrated"))) {
                var data=Path.Combine(source,"backend","data");if(Directory.Exists(data))CopyPrivate(data,Path.Combine(UserRoot,"data"));
                var pyData=Path.Combine(source,"python_engine","data");if(Directory.Exists(pyData))CopyPrivate(pyData,Path.Combine(UserRoot,"python-data"));
                var env=Path.Combine(source,"backend",".env");if(File.Exists(env)&&!File.Exists(Path.Combine(UserRoot,"settings","backend.env")))File.Copy(env,Path.Combine(UserRoot,"settings","backend.env"));
                string forge=Path.Combine(Path.GetDirectoryName(source),"stable-diffusion-webui-forge","webui-user.bat");
                File.WriteAllText(Path.Combine(UserRoot,"desktop.json"),new JavaScriptSerializer().Serialize(new{forgeBat=forge,ollamaExe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Ollama","ollama.exe")}));
                File.WriteAllText(Path.Combine(UserRoot,".migrated"),DateTime.UtcNow.ToString("o"));
            }
            Junction(Path.Combine(InstallRoot,"app","backend","data"),Path.Combine(UserRoot,"data"));
            Junction(Path.Combine(InstallRoot,"app","python_engine","data"),Path.Combine(UserRoot,"python-data"));
            Junction(Path.Combine(InstallRoot,"app","logs"),Path.Combine(UserRoot,"logs"));
            Venv("app\\python_engine\\voice_venv","python-voice","3.12.13");Venv("app\\python_engine\\venv","python-general","3.14.3");Venv(".venv","python-general","3.14.3");
            var desktop=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Jarvis.lnk");
            var menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Jarvis");Directory.CreateDirectory(menu);
            Shortcut(desktop,Path.Combine(InstallRoot,"Jarvis.exe"),"");Shortcut(Path.Combine(menu,"Jarvis.lnk"),Path.Combine(InstallRoot,"Jarvis.exe"),"");Shortcut(Path.Combine(menu,"Desinstalar Jarvis.lnk"),Path.Combine(InstallRoot,"JarvisUninstall.exe"),"--uninstall");
            using(var key=Registry.CurrentUser.CreateSubKey(RegistryPath)){key.SetValue("DisplayName","Jarvis");key.SetValue("DisplayVersion","1.0.0");key.SetValue("Publisher","Jarvis · instalación personal");key.SetValue("InstallLocation",InstallRoot);key.SetValue("DisplayIcon",Path.Combine(InstallRoot,"Jarvis.exe"));key.SetValue("UninstallString","\""+Path.Combine(InstallRoot,"JarvisUninstall.exe")+"\" --uninstall");key.SetValue("NoModify",1);key.SetValue("NoRepair",1);}
            WriteResult(true,"Instalación completada");report(100,"Jarvis está instalado.");
        }
        static bool OwnInstall(){try{return (File.GetAttributes(InstallRoot)&FileAttributes.ReparsePoint)==0&&new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(InstallRoot,"jarvis.install.json")))["product"].ToString()==Product;}catch{return false;}}
        static void Venv(string relative,string runtime,string version){var home=Path.Combine(InstallRoot,"runtime",runtime);File.WriteAllText(Path.Combine(InstallRoot,relative,"pyvenv.cfg"),"home = "+home+"\ninclude-system-site-packages = true\nversion = "+version+"\nexecutable = "+Path.Combine(home,"python.exe")+"\n");}
        static void Junction(string link,string target){if(Directory.Exists(link))return;Directory.CreateDirectory(Path.GetDirectoryName(link));var p=Process.Start(new ProcessStartInfo("cmd.exe","/c mklink /J \""+link+"\" \""+target+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true});p.WaitForExit();if(p.ExitCode!=0)throw new Exception("No se pudo preparar el directorio de datos.");}
        static void CopyPrivate(string source,string target){
            Directory.CreateDirectory(target);
            foreach(var file in Directory.GetFiles(source)){string name=Path.GetFileName(file);if(new List<string>{"jarvis_started_processes.json","local_voice_state.json","local_voice_utterance.wav","last_screen_capture.png","screen_capture.png","test_screen.png","unity_error_sample.png"}.Contains(name))continue;if(!File.Exists(Path.Combine(target,name)))File.Copy(file,Path.Combine(target,name));}
            foreach(var folder in Directory.GetDirectories(source)){string name=Path.GetFileName(folder);if((File.GetAttributes(folder)&FileAttributes.ReparsePoint)!=0||new List<string>{"node_modules","__pycache__","logs","backups","snapshots","sandbox_runs","sandbox_scratch","diagnostics"}.Contains(name))continue;CopyPrivate(folder,Path.Combine(target,name));}
        }
        static void Shortcut(string file,string target,string arguments){
            var type=Type.GetTypeFromProgID("WScript.Shell");var shell=Activator.CreateInstance(type);var shortcut=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});var st=shortcut.GetType();
            st.InvokeMember("TargetPath",BindingFlags.SetProperty,null,shortcut,new object[]{target});st.InvokeMember("Arguments",BindingFlags.SetProperty,null,shortcut,new object[]{arguments});st.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,shortcut,new object[]{InstallRoot});st.InvokeMember("IconLocation",BindingFlags.SetProperty,null,shortcut,new object[]{Path.Combine(InstallRoot,"Jarvis.exe")+",0"});st.InvokeMember("Save",BindingFlags.InvokeMethod,null,shortcut,null);
        }
        static int Uninstall(bool silent){
            if(!OwnInstall())return 1;
            if(!silent&&MessageBox.Show("Se quitará la aplicación Jarvis. Tus documentos, memoria y preferencias se conservarán.","Desinstalar Jarvis",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return 0;
            foreach(var process in Process.GetProcessesByName("Jarvis")){try{if(String.Equals(process.MainModule.FileName,Path.Combine(InstallRoot,"Jarvis.exe"),StringComparison.OrdinalIgnoreCase)){MessageBox.Show("Cerrá Jarvis antes de desinstalarlo.");return 1;}}catch(System.ComponentModel.Win32Exception){}}
            Registry.CurrentUser.DeleteSubKeyTree(RegistryPath,false);
            string desktop=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Jarvis.lnk");if(File.Exists(desktop))File.Delete(desktop);
            var menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Jarvis");foreach(var name in new[]{"Jarvis.lnk","Desinstalar Jarvis.lnk"}){var file=Path.Combine(menu,name);if(File.Exists(file))File.Delete(file);}if(Directory.Exists(menu)&&Directory.GetFileSystemEntries(menu).Length==0)Directory.Delete(menu);
            var helper=Path.Combine(Path.GetTempPath(),"Jarvis-uninstall-"+Guid.NewGuid().ToString("N")+".ps1");
            string script="$ErrorActionPreference='Stop'\n$appRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\\Jarvis'))\n$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\\Jarvis'))\nif($appRoot -ne $expected){exit 1}\n$marker=Get-Content -LiteralPath (Join-Path $appRoot 'jarvis.install.json') -Raw | ConvertFrom-Json\nif($marker.product -ne '"+Product+"'){exit 1}\nWait-Process -Id "+Process.GetCurrentProcess().Id+" -Timeout 30 -ErrorAction SilentlyContinue\nforeach($relative in @('app\\backend\\data','app\\python_engine\\data','app\\logs')){$link=Join-Path $appRoot $relative;if(Test-Path -LiteralPath $link){$item=Get-Item -LiteralPath $link -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){[IO.Directory]::Delete($link)}}}\nRemove-Item -LiteralPath $appRoot -Recurse -Force\nRemove-Item -LiteralPath $PSCommandPath -Force\n";
            File.WriteAllText(helper,script,Encoding.UTF8);Process.Start(new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+helper+"\""){UseShellExecute=false,CreateNoWindow=true});return 0;
        }
    }
}
