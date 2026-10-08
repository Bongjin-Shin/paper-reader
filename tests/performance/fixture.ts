/** Reproducible 24-page, text/vector-heavy document; no user PDF or API calls. */
export function makeScrollPdf(pageCount = 24): Uint8Array {
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pages: number[] = [];
  for (let p = 0; p < pageCount; p++) {
    const page = objects.length + 1;
    pages.push(page);
    const lines = ['BT /F1 11 Tf 48 756 Td'];
    for (let line = 0; line < 48; line++) {
      lines.push(`(Page ${p + 1}: The model maintains asymptotic complexity and context-aware decision-making.) Tj 0 -14 Td`);
    }
    lines.push('ET 0.3 w');
    for (let n = 0; n < 250; n++) lines.push(`${40 + n % 25 * 21} ${35 + Math.floor(n / 25) * 3} 18 2 re S`);
    const stream = lines.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map(n => `${n} 0 R`).join(' ')}] >>`;
  let content = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(content.length); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return new TextEncoder().encode(content + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
