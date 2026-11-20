using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Web.Script.Serialization;

namespace JarvisDesktop {
    public sealed class RigCharacter : FrameworkElement {
        private sealed class Shape { public Brush Color; public Geometry Geometry; }
        private sealed class Bone {
            public string Id, Parent; public double X, Y; public int Z;
            public Geometry TextureClip; public Rect TextureRect;
            public Brush CapBrush; public double CapRadius;
            public List<string> When = new List<string>(); public List<Shape> Shapes = new List<Shape>();
        }
        private sealed class Position { public double X,Y,Angle,Sy; }
        private readonly List<Bone> bones = new List<Bone>();
        private readonly Dictionary<string, object> animations;
        private readonly Dictionary<string,string> variantFiles=new Dictionary<string,string>();
        private readonly Dictionary<string,RigCharacter> variants=new Dictionary<string,RigCharacter>();
        private readonly HashSet<string> failedVariants=new HashSet<string>();
        private readonly BitmapSource sourceImage;
        private readonly double logicalWidth, logicalHeight;
        private readonly double[] shadow;
        private readonly DispatcherTimer timer;
        private readonly Stopwatch clock = new Stopwatch();
        private string animation = "idle";
        private bool running;
        private bool talking;
        private bool motionEnabled = true;
        private double? previewTime;
        private static double Number(object value) { return Convert.ToDouble(value); }
        private static Dictionary<string, object> Map(object value) { return (Dictionary<string, object>)value; }
        private static Geometry Polygon(object value) {
            var points=(object[])value;var geometry=new StreamGeometry();
            using(var context=geometry.Open())for(int i=0;i<points.Length;i++) {
                var p=(object[])points[i];var point=new Point(Number(p[0]),Number(p[1]));
                if(i==0)context.BeginFigure(point,true,true);else context.LineTo(point,true,false);
            }
            geometry.Freeze();return geometry;
        }

        public RigCharacter(string asset) {
            var data = Map(new JavaScriptSerializer().DeserializeObject(File.ReadAllText(asset)));
            logicalWidth=Number(data["width"]);logicalHeight=Number(data["height"]);
            shadow=new double[]{64,139,25,2};
            if(data.ContainsKey("shadow")){var s=(object[])data["shadow"];for(int i=0;i<4;i++)shadow[i]=Number(s[i]);}
            if(data.ContainsKey("source")) {
                var source=Map(data["source"]);var bitmap=new BitmapImage();bitmap.BeginInit();bitmap.UriSource=new Uri(Path.Combine(Path.GetDirectoryName(asset),Convert.ToString(source["image"])));bitmap.CacheOption=BitmapCacheOption.OnLoad;bitmap.DecodePixelHeight=1024;bitmap.EndInit();bitmap.Freeze();sourceImage=bitmap;
            }
            animations = Map(data["animations"]);
            if(data.ContainsKey("poseVariants"))foreach(var item in Map(data["poseVariants"]))variantFiles[item.Key]=Path.Combine(Path.GetDirectoryName(asset),Convert.ToString(item.Value));
            foreach (object raw in (object[])data["bones"]) {
                var row = Map(raw);
                var bone = new Bone { Id=Convert.ToString(row["id"]), Parent=Convert.ToString(row["parent"]), X=Number(row["x"]), Y=Number(row["y"]), Z=Convert.ToInt32(row["z"]) };
                if(row.ContainsKey("when")) foreach(object name in (object[])row["when"]) bone.When.Add(Convert.ToString(name));
                if(row.ContainsKey("texture")) {
                    var texture=Map(row["texture"]);var bounds=(object[])texture["rect"];
                    bone.TextureRect=new Rect(Number(bounds[0]),Number(bounds[1]),Number(bounds[2]),Number(bounds[3]));
                    Geometry clip=Polygon(texture["clip"]);
                    foreach(object excluded in (object[])texture["exclude"])clip=new CombinedGeometry(GeometryCombineMode.Exclude,clip,Polygon(excluded));
                    clip.Freeze();bone.TextureClip=clip;
                }
                if(row.ContainsKey("cap")&&sourceImage!=null) {
                    var cap=Map(row["cap"]);var box=(object[])cap["source"];
                    bone.CapRadius=Number(cap["radius"]);
                    var source=Map(data["source"]);double w=Number(source["width"]),h=Number(source["height"]);
                    var brush=new ImageBrush(sourceImage) { ViewboxUnits=BrushMappingMode.RelativeToBoundingBox,Viewbox=new Rect(Number(box[0])/w,Number(box[1])/h,Number(box[2])/w,Number(box[3])/h),Stretch=Stretch.Fill };brush.Freeze();bone.CapBrush=brush;
                }
                foreach(object rawShape in (object[])row["shapes"]) {
                    var shape=Map(rawShape);var points=(object[])shape["p"];
                    var geometry=new StreamGeometry();
                    using(var context=geometry.Open()) {
                        for(int i=0;i<points.Length;i++) {
                            var point=(object[])points[i];var p=new Point(Number(point[0]),Number(point[1]));
                            if(i==0) context.BeginFigure(p,true,true);else context.LineTo(p,true,false);
                        }
                    }
                    geometry.Freeze();var brush=(SolidColorBrush)new BrushConverter().ConvertFromString(Convert.ToString(shape["c"]));brush.Freeze();
                    bone.Shapes.Add(new Shape { Color=brush, Geometry=geometry });
                }
                bones.Add(bone);
            }
            timer=new DispatcherTimer { Interval=TimeSpan.FromMilliseconds(50) };
            timer.Tick+=delegate { InvalidateVisual(); };
            IsVisibleChanged+=delegate { UpdateTimer(); };
            Unloaded+=delegate { timer.Stop();clock.Stop(); };
            clock.Start();
        }
        public void SetAnimation(string name) {
            if(!animations.ContainsKey(name)) name="idle";
            if(animation==name) return;
            animation=name;previewTime=null;clock.Restart();
            timer.Interval=TimeSpan.FromMilliseconds(variantFiles.ContainsKey(name)?62.5:50);
            GetVariant(name);UpdateTimer();InvalidateVisual();
        }
        private RigCharacter GetVariant(string name) {
            if(!variantFiles.ContainsKey(name)||failedVariants.Contains(name))return null;
            RigCharacter value;if(variants.TryGetValue(name,out value))return value;
            try { value=new RigCharacter(variantFiles[name]);variants[name]=value;return value; }
            catch(Exception error){Trace.WriteLine("Character pose fallback: "+error.Message);failedVariants.Add(name);return null;}
        }
        public void SetRunning(bool value) { running=value;UpdateTimer(); }
        public void SetTalking(bool value) { talking=value;InvalidateVisual(); }
        public void SetMotionEnabled(bool value) { motionEnabled=value;UpdateTimer();InvalidateVisual(); }
        private void UpdateTimer() {
            if(running && IsVisible && motionEnabled) { clock.Start();timer.Start(); }
            else { timer.Stop();clock.Stop(); }
        }
        public void Seek(double seconds) { previewTime=seconds;timer.Stop();InvalidateVisual(); }
        private static double[] Sample(object raw,double t) {
            var keys=(object[])raw;var a=(object[])keys[0];var b=a;
            foreach(object key in keys) {var k=(object[])key;if(Number(k[0])<=t)a=k;if(Number(k[0])>=t){b=k;break;}b=k;}
            double u=Number(b[0])==Number(a[0])?0:Math.Max(0,Math.Min(1,(t-Number(a[0]))/(Number(b[0])-Number(a[0]))));
            u=u*u*(3-2*u);var values=new double[5];
            for(int i=1;i<5;i++)values[i]=Number(a[i])+(Number(b[i])-Number(a[i]))*u;
            return values;
        }
        protected override void OnRender(DrawingContext dc) {
            base.OnRender(dc);
            double seconds=previewTime??(motionEnabled?clock.Elapsed.TotalSeconds:0);
            var variant=GetVariant(animation);
            if(variant!=null) {variant.DrawPose(dc,ActualWidth,ActualHeight,seconds,animation);return;}
            DrawPose(dc,ActualWidth,ActualHeight,seconds,variantFiles.ContainsKey(animation)?"idle":animation);
        }
        private void DrawPose(DrawingContext dc,double width,double height,double seconds,string poseName) {
            var spec=Map(animations[poseName]);var tracks=Map(spec["tracks"]);
            double t=seconds%Number(spec["duration"]);
            var positions=new Dictionary<string,Position>();
            foreach(var bone in bones) {
                var k=tracks.ContainsKey(bone.Id)?Sample(tracks[bone.Id],t):new double[]{0,0,0,0,1};
                if(talking && bone.Id=="mouth" && motionEnabled)k[4]=.96+.14*Math.Abs(Math.Sin(seconds*10));
                Position parent=null;if(!String.IsNullOrEmpty(bone.Parent))positions.TryGetValue(bone.Parent,out parent);
                double angle=parent==null?0:parent.Angle, radians=angle*Math.PI/180, x=bone.X+k[1],y=bone.Y+k[2];
                positions[bone.Id]=new Position { X=(parent==null?0:parent.X)+x*Math.Cos(radians)-y*Math.Sin(radians),Y=(parent==null?0:parent.Y)+x*Math.Sin(radians)+y*Math.Cos(radians),Angle=angle+k[3],Sy=k[4] };
            }
            double scale=Math.Min(width/logicalWidth,height/logicalHeight);
            if(scale<=0)return;
            dc.PushTransform(new TranslateTransform((width-logicalWidth*scale)/2,(height-logicalHeight*scale)/2));dc.PushTransform(new ScaleTransform(scale,scale));
            dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(60,16,28,36)),null,new Point(shadow[0],shadow[1]),shadow[2],shadow[3]);
            var ordered=new List<Bone>(bones);ordered.Sort(delegate(Bone a,Bone b){return a.Z.CompareTo(b.Z);});
            foreach(var bone in ordered) {
                if(bone.When.Count>0&&!bone.When.Contains(poseName))continue;
                var p=positions[bone.Id];dc.PushTransform(new TranslateTransform(p.X,p.Y));dc.PushTransform(new RotateTransform(p.Angle));dc.PushTransform(new ScaleTransform(1,p.Sy));
                if(bone.CapBrush!=null&&tracks.ContainsKey(bone.Id)&&Math.Abs(Sample(tracks[bone.Id],t)[3])>2) {
                    double radius=bone.CapRadius;dc.DrawEllipse(Brushes.Black,null,new Point(0,0),radius+.25,radius+.25);dc.DrawEllipse(bone.CapBrush,null,new Point(0,0),radius,radius);
                }
                if(bone.TextureClip!=null&&sourceImage!=null){dc.PushClip(bone.TextureClip);dc.DrawImage(sourceImage,bone.TextureRect);dc.Pop();}
                foreach(var shape in bone.Shapes)dc.DrawGeometry(shape.Color,null,shape.Geometry);
                dc.Pop();dc.Pop();dc.Pop();
            }
            dc.Pop();dc.Pop();
        }
        public static void RenderPreview(string asset,string output) {
            var rig=new RigCharacter(asset);int w=(int)rig.logicalWidth*2,h=(int)rig.logicalHeight*2;rig.Width=w;rig.Height=h;
            var background=new System.Windows.Controls.Border { Width=w,Height=h,Background=new SolidColorBrush(Color.FromRgb(22,35,31)),Child=rig };
            background.Measure(new Size(w,h));background.Arrange(new Rect(0,0,w,h));
            var encoder=new GifBitmapEncoder();
            var colors=new List<Color> { Color.FromRgb(22,35,31),Color.FromRgb(20,33,31) };
            foreach(var bone in rig.bones)foreach(var shape in bone.Shapes) { var color=((SolidColorBrush)shape.Color).Color;if(!colors.Contains(color))colors.Add(color); }
            var palette=new BitmapPalette(colors);
            // Review every action in a single animation, without running Jarvis.
            string[] sequence={"wave","walk","working","sit","exercise","celebrate","question","speaking"};
            foreach(string action in sequence) {
                rig.SetAnimation(action);
                for(int i=0;i<24;i++) {
                    rig.Seek(i/12.0);background.UpdateLayout();
                    var image=new RenderTargetBitmap(w,h,96,96,PixelFormats.Pbgra32);image.Render(background);
                    var metadata=new BitmapMetadata("gif");metadata.SetQuery("/grctlext/Delay",(ushort)8);metadata.SetQuery("/grctlext/Disposal",(byte)2);
                    var indexed=new FormatConvertedBitmap(image,PixelFormats.Indexed8,rig.sourceImage==null?palette:new BitmapPalette(image,256),0);
                    encoder.Frames.Add(BitmapFrame.Create(indexed,null,metadata,null));
                }
            }
            using(var stream=File.Create(output))encoder.Save(stream);
        }
    }
}
