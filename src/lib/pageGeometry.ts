/** Keep the page frame and its painted surface in the same coordinate system.
 * This is the sole writer of their geometry: React's style diff must not compete
 * with the live zoom preview or an asynchronous canvas replacement.
 */
export function syncPageGeometry(page: HTMLElement, displayScale: number, paintedScale?: number) {
  const width = Number(page.dataset.pdfWidth), height = Number(page.dataset.pdfHeight);
  page.style.width = `${width * displayScale}px`;
  page.style.height = `${height * displayScale}px`;
  const surface = page.querySelector<HTMLElement>('.page-surface');
  if (!surface) return;
  const scale = paintedScale ?? Number(surface.dataset.paintedScale);
  if (!(scale > 0)) return;
  surface.dataset.paintedScale = String(scale);
  surface.style.width = `${width * scale}px`;
  surface.style.height = `${height * scale}px`;
  surface.style.transform = `scale(${displayScale / scale})`;
}
