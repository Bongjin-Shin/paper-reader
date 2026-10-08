/** Tiny, deterministic, two-page PDF with real selectable text; no external assets. */
export function makeTestPdf(rotation = 0, userUnit = 1): Uint8Array {
  const stream = 'BT /F1 18 Tf 72 720 Td (The model maintains an asymptotic linear complexity.) Tj 0 -36 Td (Another asymptotic result appears here.) Tj 0 -36 Td (A context-aware model improves allocation.) Tj 0 -36 Td (A game-theoretical decision-making approach.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [20 30 632 822] /Rotate ${rotation} /UserUnit ${userUnit} /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(content);
}
