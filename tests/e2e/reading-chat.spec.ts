import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend, open, select, startPageTranslation } from './helpers';

test('subscription translation and chat models are independent, effort follows the model, and chat persists', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { localStorage.setItem('test-chatgpt-connected', 'true'); });
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await page.getByLabel('번역 방식').selectOption('chatgpt');
  await page.getByLabel('번역 모델', { exact: true }).selectOption('test-reasoner');
  await expect(page.getByLabel('번역 effort')).toHaveValue('');
  await page.getByLabel('번역 effort').selectOption('medium');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('채팅 모델', { exact: true }).selectOption('test-reasoner');
  await expect(page.getByLabel('채팅 effort').locator('option')).toHaveText(['기본값 · medium', 'medium', 'high']);
  await page.getByLabel('채팅 effort').selectOption('high');
  await page.getByLabel('논문 질문').fill('이 방법의 복잡도를 설명해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.locator('.chat-answer')).toContainText('복잡도');
  await page.screenshot({ path: 'test-results/paper-chat.png' });
  const request = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'ask_paper').args.request);
  expect(request.context).toContain('asymptotic'); expect(request.context).toContain('[p. 2;');
  await page.getByRole('button', { name: '[p. 2]', exact: true }).click();
  expect(await page.locator('.reader').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  await page.getByLabel('채팅 모델', { exact: true }).selectOption('gpt-5.6-luna');
  await expect(page.getByLabel('채팅 effort')).toHaveValue('');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('test-models')!));
  expect(settings.translationModel).toBe('test-reasoner'); expect(settings.translationEffort).toBe('medium'); expect(settings.chatModel).toBe('gpt-5.6-luna');
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-answer')).toContainText('복잡도');
  await expect(page.getByLabel('채팅 모델', { exact: true })).toHaveValue('gpt-5.6-luna');
});

test('chat failure retains the question for retry and closing during a request retains the answer', async ({ page }) => {
  await installBackend(page); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.evaluate(() => { (window as any).__chatFail = true; });
  await page.getByLabel('논문 질문').fill('실험 결과는?'); await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByRole('alert')).toContainText('채팅 연결 실패');
  await expect(page.getByLabel('논문 질문')).toHaveValue('실험 결과는?');
  await page.evaluate(() => { (window as any).__chatFail = false; (window as any).__chatDelay = 600; });
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await page.getByRole('button', { name: '논문 채팅 닫기' }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-answer')).toHaveCount(1);
  await expect(page.getByLabel('논문 질문')).toHaveValue('');
});

test('cross-page sentence is complete in both paired pages while translation interiors scroll independently', async ({ page }) => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const a = doc.addPage([612, 792]), b = doc.addPage([612, 792]);
  a.drawText('A complete sentence.', { x: 40, y: 720, font, size: 12 });
  a.drawText('The proposed method improves', { x: 40, y: 100, font, size: 12 });
  b.drawText('accuracy while reducing complexity.', { x: 40, y: 720, font, size: 12 });
  b.drawText('A separate result follows.', { x: 40, y: 700, font, size: 12 });
  await installBackend(page, undefined, await doc.save()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translation-page').first().locator('.translated-sentence')).toHaveCount(2);
  await page.evaluate(() => { (window as any).__firstSentence = document.querySelector('.translated-sentence'); });
  const before = await page.locator('.translation-page-content').first().evaluate(el => el.scrollTop);
  await page.locator('.reader').evaluate(el => { el.scrollTop += 300; });
  await expect.poll(() => page.locator('.translation-page-content').first().evaluate(el => el.scrollTop)).toBe(before);
  expect(await page.evaluate(() => (window as any).__firstSentence.isConnected)).toBe(true);
  await page.getByRole('button', { name: '다음 번역 페이지' }).click();
  const readingPosition = await page.locator('.reader').evaluate(el => el.scrollTop);
  await page.locator('.translation-page').nth(1).getByRole('button', { name: '이 페이지 번역' }).click();
  await expect(page.locator('.translated-sentence')).toHaveCount(4);
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollTop)).toBeCloseTo(readingPosition, 0);
  const requests = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'translate_page').map((c: any) => c.args.request));
  expect(requests[0].sentences[1].text).toBe('The proposed method improves accuracy while reducing complexity.');
  expect(requests[1].sentences[0].text).toBe(requests[0].sentences[1].text);
  expect(requests[0].sentences[1].rects).not.toEqual(requests[1].sentences[0].rects);
  await page.locator('.translation-page').nth(1).locator('.translated-sentence').first().click();
  await expect(page.locator('.pdf-page[data-page-number="1"] .translation-source-mark')).toHaveCount(1);
  await expect(page.locator('.pdf-page[data-page-number="2"] .translation-source-mark')).toHaveCount(1);
  await expect(page.locator('.translated-sentence[aria-pressed="true"]')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/continuous-translation.png' });
  const beforeReverse = await page.locator('.reader').evaluate(el => el.scrollTop);
  const pane = (await page.locator('.translation-page-content').nth(1).boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollTop)).toBeLessThan(beforeReverse);
});

test('translation resize leaves room for the PDF while chat is open', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  const handle = page.getByRole('separator', { name: '1페이지 번역창 너비 조절' }), box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down(); await page.mouse.move(30, box.y + 100, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await page.locator('.reader').boundingBox())!.width).toBeGreaterThanOrEqual(260);
  await expect(page.getByRole('complementary', { name: '논문 채팅' })).toBeVisible();
});

test('dashed connector joins bubble and source centers through dragging, scrolling and zoom', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-bubble')).toContainText('점근적인');
  await page.locator('.word-bubble').click();
  const check = async () => {
    await expect.poll(async () => page.evaluate(() => {
      const line = document.querySelector<SVGLineElement>('.bubble-connector line')!, svg = line.ownerSVGElement!.getBoundingClientRect();
      const bubble = document.querySelector('.word-bubble')!.getBoundingClientRect(), mark = document.querySelector('.word-highlight')!.getBoundingClientRect();
      return Math.max(Math.abs(svg.left + line.x1.baseVal.value - bubble.left - bubble.width / 2), Math.abs(svg.top + line.y1.baseVal.value - bubble.top - bubble.height / 2),
        Math.abs(svg.left + line.x2.baseVal.value - mark.left - mark.width / 2), Math.abs(svg.top + line.y2.baseVal.value - mark.top - mark.height / 2));
    })).toBeLessThan(3);
  };
  await check();
  const box = (await page.locator('.word-bubble').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 160, { steps: 5 }); await page.mouse.up(); await check();
  await page.locator('.reader').evaluate(el => { el.scrollTop += 100; }); await check();
  await page.getByRole('button', { name: '확대', exact: true }).click(); await check();
  await page.screenshot({ path: 'test-results/bubble-connector.png' });
});

test('chat renders math and Markdown, accepts input while thinking and replaces send with stop with persisted followups', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => {
    (window as any).__chatDelay = 30000; (window as any).__chatStreaming = true;
    (window as any).__chatMarkdown = '**평활화된 잔차**입니다. \\(r_i^s\\)는 첨자입니다. [p. 2]\n\n\\[\nr_i^s=\\lambda r_i+(1-\\lambda)r_{i-1}^s\n\\]\n\n- 현재 잔차와 이전 잔차를 결합합니다.\n- 계수의 의미를 설명합니다.';
  });
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByLabel('구독 잔여 사용량')).toContainText('5시간 75% 남음');
  await expect(page.getByLabel('구독 잔여 사용량')).toContainText('주간 60% 남음');
  await page.getByLabel('논문 질문').fill('수식을 설명해줘'); await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-answer .katex')).toHaveCount(2);
  await expect(page.locator('.chat-answer strong')).toHaveText('평활화된 잔차');
  await expect(page.locator('.chat-answer li')).toHaveCount(2);
  await expect(page.getByLabel('논문 질문')).toBeEnabled();
  await page.getByLabel('논문 질문').fill('기호의 의미도 알려줘'); await page.getByRole('button', { name: '추가 질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-question').last()).toContainText('기호의 의미도');
  await expect(page.getByLabel('논문 질문')).toHaveValue('');
  await expect(page.locator('.chat-actions button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '다음 답변으로 예약' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/chat-math-streaming.png' });
  await page.getByRole('button', { name: '답변 중단', exact: true }).click();
  await expect(page.locator('.chat-exchange')).toContainText('답변 중단됨');
  await page.evaluate(() => { (window as any).__chatDelay = 0; });
  await page.getByLabel('논문 질문').fill('다음에는 실험을 설명해줘');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-exchange')).toHaveCount(2);
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-question')).toHaveCount(3);
  await expect(page.locator('.chat-exchange').first()).toContainText('답변 중단됨');
});

test('failed mid-turn input preserves the draft for sending after completion', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__chatDelay = 2200; (window as any).__steerFail = true; });
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('논문 질문').fill('첫 질문'); await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  await page.getByLabel('논문 질문').fill('둘째 질문'); await page.getByRole('button', { name: '추가 질문 보내기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('추가 질문을 반영하지 못했습니다.');
  await expect(page.getByLabel('논문 질문')).toHaveValue('둘째 질문');
  await expect(page.getByRole('button', { name: '질문 보내기', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__chatDelay = 0; });
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-exchange')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper').map((c: any) => c.args.request.question))).toEqual(['첫 질문', '둘째 질문']);
});

test('same-size manuscript headings, paragraphs and typography survive translation', async ({ page }) => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.HelveticaBold), italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sheet = doc.addPage([612, 792]);
  const lines = ['Earlier text continues', 'and ends here.', 'INTRODUCTION', 'Pipeline leakage has several influences on water distribution', 'networks. More explanation follows', 'and the paragraph ends here.', 'A new paragraph begins with emphasis.'];
  lines.forEach((text, i) => {
    sheet.drawText(String(26 + i), { x: 30, y: 710 - i * 28, size: 12, font });
    sheet.drawText(text, { x: 65, y: 710 - i * 28, size: 12, font: i === 2 ? bold : i === 6 ? italic : font });
  });
  await installBackend(page, undefined, await doc.save()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translation-heading')).toHaveCount(1);
  await expect(page.locator('.translation-heading .translated-sentence')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.translation-paragraph').last().locator('.translated-sentence')).toHaveCSS('font-style', 'italic');
  const request = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'translate_page').args.request);
  expect(request.sentences.find((s: any) => s.layout.kind === 'heading').text).toBe('INTRODUCTION');
  expect(request.sentences.map((s: any) => s.text).join(' ')).not.toMatch(/\b(?:26|27|28|29|30|31|32)\b/);
  await page.screenshot({ path: 'test-results/manuscript-structure.png' });
});
