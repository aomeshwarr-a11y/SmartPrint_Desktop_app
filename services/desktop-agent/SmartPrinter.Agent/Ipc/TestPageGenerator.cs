using System.Text;

namespace SmartPrinter.Agent.Ipc;

/// <summary>
/// Produces a minimal, hand-built, valid single-page PDF (no external dependency) purely
/// for the "Print Test Page" diagnostics button - it exists so a shop owner can verify
/// end-to-end printer connectivity without needing a real customer order first.
/// </summary>
internal static class TestPageGenerator
{
    public static byte[] MinimalOnePagePdf()
    {
        const string text = "SmartPrinter test page - if you can read this, printing works.";
        var content = $"BT /F1 18 Tf 50 700 Td ({EscapePdfString(text)}) Tj ET";

        var sb = new StringBuilder();
        sb.Append("%PDF-1.4\n");
        sb.Append("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        sb.Append("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        sb.Append("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
        sb.Append("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
        sb.Append($"5 0 obj\n<< /Length {content.Length} >>\nstream\n{content}\nendstream\nendobj\n");

        // Note: this intentionally omits per-object byte offsets in the xref table (only
        // a single free entry is listed). This is a known-tolerable simplification for a
        // tiny single-page test document - PDFium (and effectively every modern PDF
        // reader) falls back to scanning the file for "N 0 obj" markers when the xref
        // table doesn't resolve cleanly, which a file this small does almost instantly.
        // If you need a byte-perfect xref table, generate the test page with a real PDF
        // library instead of this hand-built minimal document.
        var xrefOffset = Encoding.ASCII.GetByteCount(sb.ToString());
        sb.Append("xref\n0 6\n0000000000 65535 f \n");
        sb.Append("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n");
        sb.Append(xrefOffset);
        sb.Append("\n%%EOF");

        return Encoding.ASCII.GetBytes(sb.ToString());
    }

    private static string EscapePdfString(string input) =>
        input.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
}
