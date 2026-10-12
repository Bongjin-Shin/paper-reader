import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend, open, startPageTranslation } from './helpers';
import { makeSentenceMathPdf } from '../sentenceMathFixture';

test('numbered Markdown sentences highlight the whole list in both hover directions', async ({ page }) => {
  await installBackend(page, undefined, await makeSentenceMathPdf()); await open(page);
  await page.evaluate(() => { (window as any).__longPageTranslation = '1) 게이트 유닛을 사용하는 다중 헤드 어텐션: 입력의 의존성을 설명합니다.'; });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  const sentence = page.locator('.translated-sentence[data-sentence-id="1"]');
  await expect(sentence.locator('ol')).toBeVisible();
  await sentence.locator('li').hover();
  await expect(sentence).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.translation-source-mark')).toHaveCount(3);
  const contains = await sentence.evaluate(el => {
    const box = el.getBoundingClientRect(), list = el.querySelector('ol')!.getBoundingClientRect();
    return getComputedStyle(el).display === 'block' && box.top <= list.top && box.bottom >= list.bottom;
  });
  expect(contains).toBe(true);
  const source = (await page.locator('.translation-source-mark').first().boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await expect(sentence).toHaveAttribute('aria-pressed', 'true');
  await expect(sentence).toHaveCSS('background-color', 'rgb(222, 223, 221)');
});

test('per-row tags render and scroll at narrow widths without colliding with equations', async ({ page }) => {
  await installBackend(page, undefined, await makeSentenceMathPdf()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translation-equation .katex')).toHaveCount(1);
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('test-page-translations')!);
    const equation = rows[0].sentences.find((s: any) => s.layout.kind === 'equation');
    equation.layout.typography.fontScale = .7;
    equation.equations[0].latex = String.raw`\begin{aligned}Q,K,V&=W^Qh^q, W^Kh^{k,v}, W^Vh^{k,v}\tag{3}\\\alpha_z&=\operatorname{Attention}(Q_z,K_z,V_z)\tag{4}\\&=\operatorname{Softmax}\left(\frac{Q_zK_z^T}{\sqrt d}\right)V_z\tag{5}\\\operatorname{MHA}(h^q,h^{k,v})&=\operatorname{Concat}(\alpha_1,\alpha_2,\ldots,\alpha_Z)W^O\tag{6}\end{aligned}`;
    localStorage.setItem('test-page-translations', JSON.stringify(rows));
  });
  await page.reload(); await open(page); await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  const equation = page.locator('.translation-equation');
  await expect(equation.locator('.katex')).toHaveCount(1);
  await expect(equation.locator('.translation-math-fallback, .katex-error, .tag')).toHaveCount(0);
  await expect(equation.locator('.translated-sentence')).toHaveCSS('font-size', '15px');
  await expect(equation.locator('math mtr')).toHaveCount(4);
  const handle = page.getByRole('separator', { name: '1페이지 번역창 너비 조절' }); await handle.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  const content = page.locator('.translation-page-content').first();
  expect(await content.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const scroll = equation.locator('.translation-math.display');
  expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: '.tools/translation-layout-qa/numbered-equations.png' });
});

test('a fraction numerator beside the other column stays with its denominator', async ({ page }) => {
  const doc = await PDFDocument.create(), regular = await doc.embedFont(StandardFonts.Helvetica), math = await doc.embedFont(StandardFonts.Symbol);
  const p = doc.addPage([612, 792]);
  const line = (text: string, x: number, y: number) => p.drawText(text, { x, y, size: 10, font: regular });
  for (let i = 0; i < 4; i++) { line('Left body discusses the method.', 40, 730 - i * 13); line('Right body discusses another method.', 320, 734 - i * 13); }
  line('The average is defined as:', 40, 668);
  line('W =', 120, 651); line('1', 163, 658);
  p.drawLine({ start: { x: 160, y: 654 }, end: { x: 175, y: 654 }, thickness: .4 });
  p.drawText('κ', { x: 160, y: 644, size: 10, font: math });
  p.drawText('μ', { x: 166, y: 642, size: 7, font: math }); line('(1)', 274, 651);
  line('Right prose on the numerator baseline.', 320, 658);
  line('This follows the equation.', 40, 624); line('More prose in the other column.', 320, 632);
  await installBackend(page, undefined, await doc.save()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translation-equation .katex')).toHaveCount(1);
  const source = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'translate_page').args.request.sentences);
  const equation = source.find((s: any) => s.layout.kind === 'equation').layout.math[0];
  expect(equation.glyphs.map((g: any) => g.text)).toContain('1');
  expect(equation.fractionBars).toHaveLength(1);
  expect(equation.glyphs.every((g: any) => g.width > 0)).toBe(true);
  expect(source.some((s: any) => s.text.endsWith('as: 1'))).toBe(false);
});
