// Horu.exe – starts the Horu laptop service (node server/src/main.ts) without a
// console window, restarts it if it crashes and shows a tray icon with a small
// menu. Registered as a Windows autostart entry, so it shows up as "Horu" in
// Task Manager → Startup apps.
//
//   Horu.exe          start (does nothing if already running)
//   Horu.exe --stop   stop a running instance

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Horu")]
[assembly: AssemblyProduct("Horu")]
[assembly: AssemblyDescription("Horu sentence mining service")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

static class Program
{
    const string MutexName = "Local\\HoruService";
    const string StopEventName = "Local\\HoruServiceStop";
    public const string Url = "http://localhost:7317";

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--stop")
        {
            EventWaitHandle stop;
            if (EventWaitHandle.TryOpenExisting(StopEventName, out stop)) stop.Set();
            return 0;
        }

        bool created;
        using (var mutex = new Mutex(true, MutexName, out created))
        {
            if (!created) return 0; // already running
            using (var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, StopEventName))
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(stopEvent));
            }
        }
        return 0;
    }

    public static string RootDir()
    {
        // tools/launcher/Horu.exe -> project root
        var exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        return Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
    }

    public static string FindNode()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(';'))
        {
            try
            {
                var candidate = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException) { }
        }
        var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(fallback) ? fallback : "node.exe";
    }

    public static void Open(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception) { }
    }
}

/// Owns the tray icon and the supervised node process.
class TrayContext : ApplicationContext
{
    readonly EventWaitHandle stopEvent;
    readonly NotifyIcon tray;
    // Marshals calls from worker threads onto the UI thread. The menu's own
    // handle only exists once it was opened, so it cannot be used for that.
    readonly Control ui = new Control();
    readonly System.Windows.Forms.Timer healthTimer;
    readonly object gate = new object();
    Process proc;
    volatile bool quitting;
    volatile bool restartRequested;

    public TrayContext(EventWaitHandle stopEvent)
    {
        this.stopEvent = stopEvent;
        ui.CreateControl();
        var forceHandle = ui.Handle;

        var menu = new ContextMenuStrip();
        var title = new ToolStripMenuItem("Horu") { Enabled = false };
        menu.Items.Add(title);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open Horu", null, (s, e) => Program.Open(Program.Url));
        menu.Items.Add("Connect phone…", null, (s, e) => Program.Open(Program.Url + "/pair"));
        menu.Items.Add("Show log", null, (s, e) => Program.Open(Path.Combine(Program.RootDir(), "data", "horu.log")));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Restart", null, (s, e) => Restart());
        menu.Items.Add("Quit Horu", null, (s, e) => Quit());

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location),
            Text = "Horu – starting…",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.DoubleClick += (s, e) => Program.Open(Program.Url);

        // A --stop from another process (installer) closes us cleanly.
        ThreadPool.RegisterWaitForSingleObject(stopEvent, (state, timedOut) => ui.BeginInvoke(new Action(Quit)), null, -1, true);

        healthTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        healthTimer.Tick += (s, e) => CheckHealth();
        healthTimer.Start();

        new Thread(Supervise) { IsBackground = true, Name = "supervisor" }.Start();
    }

    void SetStatus(string text)
    {
        // NotifyIcon.Text is limited to 63 characters.
        if (text.Length > 63) text = text.Substring(0, 63);
        try { ui.BeginInvoke(new Action(() => { if (!quitting) tray.Text = text; })); } catch (InvalidOperationException) { }
    }

    void CheckHealth()
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(Program.Url + "/api/status");
                req.Timeout = 3000;
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    SetStatus(res.StatusCode == HttpStatusCode.OK ? "Horu – running" : "Horu – not responding");
                }
            }
            catch (Exception)
            {
                if (!quitting) SetStatus("Horu – starting…");
            }
        });
    }

    void Supervise()
    {
        var root = Program.RootDir();
        var node = Program.FindNode();
        var backoff = 2000;
        while (!quitting)
        {
            var started = DateTime.UtcNow;
            Process p;
            try
            {
                p = Process.Start(new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "\"" + Path.Combine(root, "server", "src", "main.ts") + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            }
            catch (Exception)
            {
                SetStatus("Horu – node.js not found");
                Thread.Sleep(30000);
                continue;
            }
            lock (gate) proc = p;
            p.WaitForExit();
            if (quitting) return;
            if (restartRequested)
            {
                restartRequested = false;
                continue;
            }
            // Exit code 0 = deliberate (e.g. another server already owns the port).
            if (p.ExitCode == 0)
            {
                SetStatus("Horu – running (other instance)");
                return;
            }
            SetStatus("Horu – crashed, restarting…");
            backoff = (DateTime.UtcNow - started).TotalMinutes > 5 ? 2000 : Math.Min(backoff * 2, 60000);
            Thread.Sleep(backoff);
        }
    }

    void KillServer()
    {
        lock (gate)
        {
            if (proc == null || proc.HasExited) return;
            // /T also ends child processes (Python workers, Suwayomi).
            try
            {
                var kill = Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + proc.Id) { CreateNoWindow = true, UseShellExecute = false });
                kill.WaitForExit(5000);
            }
            catch (Exception) { }
            try { if (!proc.HasExited) proc.Kill(); } catch (Exception) { }
        }
    }

    void Restart()
    {
        restartRequested = true;
        SetStatus("Horu – restarting…");
        KillServer();
    }

    void Quit()
    {
        if (quitting) return;
        quitting = true;
        healthTimer.Stop();
        KillServer();
        tray.Visible = false;
        tray.Dispose();
        ExitThread();
    }
}
