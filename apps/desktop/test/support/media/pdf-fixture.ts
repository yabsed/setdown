/** A small deterministic PDF with searchable text, varied pages and an outline. */
export function pdfFixture(pages = 12): Buffer {
  const objects: string[] = [];
  const put = (text: string) => { objects.push(text); return objects.length; };
  put(''); put('');
  const font = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (let page = 1; page <= pages; page++) {
    const rows = Array.from({ length: 25 }, (_, row) =>
      `BT /F1 16 Tf 60 ${740 - row * 26} Td (PDF page ${page} - searchable line ${row + 1}) Tj ET`).join('\n');
    const stream = put(`<< /Length ${Buffer.byteLength(rows)} >>\nstream\n${rows}\nendstream`);
    pageIds.push(put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page % 2 ? 612 : 640} 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const outline = put('');
  const item = put(`<< /Title (Chapter Five) /Parent ${outline} 0 R /Dest [${pageIds[Math.min(4, pages - 1)]} 0 R /Fit] >>`);
  objects[outline - 1] = `<< /Type /Outlines /First ${item} 0 R /Last ${item} 0 R /Count 1 >>`;
  objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outline} 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  let result = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
