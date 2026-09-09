using System.Drawing;
using Microsoft.Extensions.Logging;
using PdfiumViewer;

namespace SmartPrinter.Agent.Printing;

/// <summary>
/// PDF rendering backed by PdfiumViewer (a managed wrapper around Google's PDFium engine,
/// the same rendering engine used by Chrome). We chose this over shelling out to a
/// system PDF viewer or invoking a file association for two reasons:
///   1. It never opens a visible window - it renders directly to an in-memory bitmap,
///      satisfying the "no visible PDF viewer window" requirement.
///   2. It runs fully in-process, so a malformed/malicious PDF cannot leverage whatever
///      the user's default PDF reader happens to be (which is a much larger, more
///      exploit-prone attack surface than a focused rendering library).
/// The native PDFium binary (pdfium.dll, x64) is shipped via the
/// PdfiumViewer.Native.x86_64.v8-xfa NuGet package - see docs/WINDOWS-PRINTERS.md.
/// </summary>
public sealed class PdfiumPrintEngine : IPdfPrintEngine
{
    private readonly ILogger<PdfiumPrintEngine> _logger;

    public PdfiumPrintEngine(ILogger<PdfiumPrintEngine> logger)
    {
        _logger = logger;
    }

    public IPdfDocumentHandle Open(string localFilePath)
    {
        if (!File.Exists(localFilePath))
        {
            throw new FileNotFoundException("PDF file not found for printing.", localFilePath);
        }

        try
        {
            var document = PdfDocument.Load(localFilePath);
            return new PdfiumDocumentHandle(document, _logger);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to open PDF {Path} - it may be corrupt, encrypted, or not a valid PDF", localFilePath);
            throw;
        }
    }

    private sealed class PdfiumDocumentHandle : IPdfDocumentHandle
    {
        private readonly PdfDocument _document;
        private readonly ILogger _logger;
        private bool _disposed;

        public PdfiumDocumentHandle(PdfDocument document, ILogger logger)
        {
            _document = document;
            _logger = logger;
        }

        public int PageCount => _document.PageCount;

        public Bitmap RenderPageToImage(int pageIndex, int widthPx, int heightPx)
        {
            if (pageIndex < 0 || pageIndex >= PageCount)
            {
                throw new ArgumentOutOfRangeException(nameof(pageIndex));
            }

            // 300 DPI-equivalent quality via width/height passed by the caller (the printer's
            // reported printable-area pixel dimensions), full color - PrintDocument's page
            // settings (Color=false) instruct the driver to render as grayscale on the way
            // to the physical printer even when we hand it a color bitmap here.
            return (Bitmap)_document.Render(pageIndex, widthPx, heightPx, 300, 300, PdfRenderFlags.Annotations);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _document.Dispose();
            _disposed = true;
        }
    }
}
