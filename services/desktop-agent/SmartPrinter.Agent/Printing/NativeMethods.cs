using System.Runtime.InteropServices;

namespace SmartPrinter.Agent.Printing;

/// <summary>
/// Raw Win32 Print Spooler (winspool.drv) declarations. Kept isolated in one file so the
/// unsafe/interop surface area is easy to audit - nothing outside <see cref="WindowsPrinterService"/>
/// should ever call into this class directly.
/// </summary>
internal static class NativeMethods
{
    private const string WinSpool = "winspool.drv";

    // ---- Enumeration ----
    internal const int PRINTER_ENUM_LOCAL = 0x00000002;
    internal const int PRINTER_ENUM_CONNECTIONS = 0x00000004;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PRINTER_INFO_2
    {
        public string? pServerName;
        public string? pPrinterName;
        public string? pShareName;
        public string? pPortName;
        public string? pDriverName;
        public string? pComment;
        public string? pLocation;
        public IntPtr pDevMode;
        public string? pSepFile;
        public string? pPrintProcessor;
        public string? pDatatype;
        public string? pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    // Printer status bit flags (subset of the documented PRINTER_STATUS_* constants).
    internal const uint PRINTER_STATUS_PAUSED = 0x00000001;
    internal const uint PRINTER_STATUS_ERROR = 0x00000002;
    internal const uint PRINTER_STATUS_PAPER_JAM = 0x00000008;
    internal const uint PRINTER_STATUS_PAPER_OUT = 0x00000010;
    internal const uint PRINTER_STATUS_OFFLINE = 0x00000080;
    internal const uint PRINTER_STATUS_BUSY = 0x00000200;
    internal const uint PRINTER_STATUS_PRINTING = 0x00000400;
    internal const uint PRINTER_STATUS_NOT_AVAILABLE = 0x00001000;

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool EnumPrinters(
        int flags, string? name, uint level, IntPtr pPrinterEnum, uint cbBuf,
        out uint pcbNeeded, out uint pcReturned);

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport(WinSpool, SetLastError = true)]
    internal static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool GetPrinter(
        IntPtr hPrinter, uint level, IntPtr pPrinter, uint cbBuf, out uint pcbNeeded);

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern int DeviceCapabilities(
        string pDevice, string pPort, short fwCapability, IntPtr pOutput, IntPtr pDevMode);

    // DC_* capability indices used by DeviceCapabilities.
    internal const short DC_DUPLEX = 7;
    internal const short DC_COLORDEVICE = 32;

    // ---- Job submission (raw spooler doc, used only for already-rasterized/EMF data;
    // primary PDF page submission goes through System.Drawing.Printing.PrintDocument,
    // which itself calls into these same spooler entry points under the hood). ----

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct JOB_INFO_2
    {
        public uint JobId;
        public string? pPrinterName;
        public string? pMachineName;
        public string? pUserName;
        public string? pDocument;
        public string? pNotifyName;
        public string? pDatatype;
        public string? pPrintProcessor;
        public string? pParameters;
        public string? pDriverName;
        public IntPtr pDevMode;
        public string? pStatus;
        public IntPtr pSecurityDescriptor;
        public uint Status;
        public uint Priority;
        public uint Position;
        public uint StartTime;
        public uint UntilTime;
        public uint TotalPages;
        public uint Size;
        public System.Runtime.InteropServices.ComTypes.FILETIME Submitted;
        public uint Time;
        public uint PagesPrinted;
    }

    internal const uint JOB_STATUS_PAUSED = 0x00000001;
    internal const uint JOB_STATUS_ERROR = 0x00000002;
    internal const uint JOB_STATUS_DELETING = 0x00000004;
    internal const uint JOB_STATUS_SPOOLING = 0x00000008;
    internal const uint JOB_STATUS_PRINTING = 0x00000010;
    internal const uint JOB_STATUS_OFFLINE = 0x00000020;
    internal const uint JOB_STATUS_PAPEROUT = 0x00000040;
    internal const uint JOB_STATUS_PRINTED = 0x00000080;
    internal const uint JOB_STATUS_DELETED = 0x00000100;
    internal const uint JOB_STATUS_BLOCKED_DEVQ = 0x00000200;
    internal const uint JOB_STATUS_USER_INTERVENTION = 0x00000400;
    internal const uint JOB_STATUS_RESTART = 0x00000800;

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool EnumJobs(
        IntPtr hPrinter, uint firstJob, uint noJobs, uint level,
        IntPtr pJob, uint cbBuf, out uint pcbNeeded, out uint pcReturned);

    [DllImport(WinSpool, SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool GetJob(
        IntPtr hPrinter, uint jobId, uint level, IntPtr pJob, uint cbBuf, out uint pcbNeeded);

    [DllImport(WinSpool, SetLastError = true)]
    internal static extern bool SetJob(IntPtr hPrinter, uint jobId, uint level, IntPtr pJob, uint command);

    internal const uint JOB_CONTROL_CANCEL = 3;
}
