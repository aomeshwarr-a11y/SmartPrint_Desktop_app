using System.Drawing;

namespace SmartPrinter.Agent.Printing;

/// <summary>
/// Renders a PDF page-by-page to bitmaps entirely in-process, with no visible viewer
/// window ever opened - this is the key requirement from ARCHITECTURE.md §7: the agent
/// must never shell out to a PDF viewer or invoke a file's default "open" association.
/// </summary>
public interface IPdfPrintEngine
{
    IPdfDocumentHandle Open(string localFilePath);
}

public interface IPdfDocumentHandle : IDisposable
{
    int PageCount { get; }

    /// <summary>Renders the given zero-based page index to a bitmap sized to fit the target
    /// printable area in pixels, preserving aspect ratio.</summary>
    Bitmap RenderPageToImage(int pageIndex, int widthPx, int heightPx);
}
