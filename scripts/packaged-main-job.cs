using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// 只用于模拟进程树的安全自测。关闭 guardian 时由内核清理整个 Job，不按进程名终止。
public sealed class RecallSmokeJob : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public IntPtr reserved, desktop, title; public int x,y,cx,cy,xc,yc,fill,flags;
    public short show, reserved2; public IntPtr reservedPtr, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
    public long processTime, jobTime; public uint flags; public UIntPtr min, max; public uint active;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
    public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
    public long a,b,c,d; public uint faults,total,active,terminated;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMIT info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ACCOUNTING info, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder command,
    IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  IntPtr job, processHandle;
  public uint ProcessId { get; private set; }
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes=0; continue; }
      result.Append('\\', slashes); slashes=0; result.Append(c);
    }
    result.Append('\\', slashes * 2); return result.Append('"').ToString();
  }
  public RecallSmokeJob(string executable, string[] args, string cwd, IDictionary<string,string> environment) {
    job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
    var limit = new EXTENDED_LIMIT(); limit.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE，禁止 breakaway。
    IntPtr block = IntPtr.Zero; var pi = new PROCESS_INFORMATION(); bool assigned = false;
    try {
      Check(SetInformationJobObject(job, 9, ref limit, (uint)Marshal.SizeOf(limit)));
      var keys = new List<string>(environment.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase);
      var env = new StringBuilder(); foreach (string key in keys) env.Append(key).Append('=').Append(environment[key]).Append('\0');
      env.Append('\0'); block = Marshal.StringToHGlobalUni(env.ToString());
      var command = new StringBuilder(Quote(executable)); foreach (string arg in args) command.Append(' ').Append(Quote(arg));
      var startup = new STARTUPINFO(); startup.cb=Marshal.SizeOf(startup);
      Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000404, block, cwd, ref startup, out pi));
      Check(AssignProcessToJobObject(job, pi.process)); assigned=true;
      if (ResumeThread(pi.thread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
      processHandle=pi.process; ProcessId=pi.pid;
    } catch {
      // 未加入 Job 的 suspended 子进程也必须结束，不能让异常留下启动现场。
      if (pi.process != IntPtr.Zero) { if (assigned) TerminateJobObject(job, 125); else TerminateProcess(pi.process, 125); WaitForSingleObject(pi.process, 5000); CloseHandle(pi.process); }
      Dispose(); throw;
    } finally { if (pi.thread != IntPtr.Zero) CloseHandle(pi.thread); if (block != IntPtr.Zero) Marshal.FreeHGlobal(block); }
  }
  public bool Wait(uint milliseconds) {
    uint result=WaitForSingleObject(processHandle, milliseconds);
    if(result==0)return true; if(result==258)return false;
    throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public uint Active {
    get { ACCOUNTING info; Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero)); return info.active; }
  }
  public uint ExitCode { get { uint code; Check(GetExitCodeProcess(processHandle, out code)); return code; } }
  public void Stop() { Check(TerminateJobObject(job, 124)); }
  public void Dispose() { if (job != IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; } if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); processHandle=IntPtr.Zero; } }
}
