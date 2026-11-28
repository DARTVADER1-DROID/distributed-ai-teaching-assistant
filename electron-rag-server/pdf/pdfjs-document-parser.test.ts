import assert from "node:assert/strict";
import { PdfJsDocumentParser } from "./pdfjs-document-parser.js";

/** Builds a tiny standards-compliant PDF fixture without adding a test dependency. */
function createPdfFixture(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  const stream = [
    "BT",
    "/F1 24 Tf",
    "72 720 Td",
    "(PDF Parser Integration Heading) Tj",
    "0 -36 Td",
    "/F1 12 Tf",
    "(PDF.js extracts this body text.) Tj",
    "ET",
  ].join("\n");
  objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

async function main(): Promise<void> {
  const parser = new PdfJsDocumentParser();
  const parsed = await parser.parseWithMetrics(createPdfFixture());

  assert.equal(parsed.document.pages.length, 1);
  const pageText = parser.getPageText(parsed.document)[0]?.text ?? "";
  assert.match(pageText, /PDF Parser Integration Heading/);
  assert.match(pageText, /PDF\.js extracts this body text/);

  const extracted = parser.toExtractedPdfData(parsed.document);
  assert.equal(extracted.page_count, 1);
  assert.ok(extracted.lines.length >= 2);
  assert.ok(extracted.ordered_font_sizes.includes(24));
  assert.ok(extracted.ordered_font_sizes.includes(12));
  assert.ok(parsed.pdf_loading_ms >= 0);
  assert.ok(parsed.page_text_extraction_ms >= 0);

  console.log("PDF.js integration test passed.");
}

void main().catch((error: unknown) => {
  console.error("PDF.js integration test failed:", error);
  process.exitCode = 1;
});
