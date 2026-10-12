import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';

async function clickWord(page: Page, word = 'asymptotic', pageNumber = 1) {
  const box = await wordBox(page, word, 0, pageNumber);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function dragSentence(page: Page) {
  const a = await wordBox(page, 'model'), b = await wordBox(page, 'complexity');
  await page.mouse.move(a.x + .2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - .2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '선택 텍스트 도구' })).toBeVisible();
}

test('dragging across a mark never offers deletion; clicking overlaps removes one mark at a time, shortest first', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const original = JSON.parse(localStorage.getItem('test-highlights')!)[0];
    const medium = { ...original, id: 20, selectedText: 'asymptotic linear', position: { ...original.position,
      endOffset: original.position.endOffset + 7, rects: original.position.rects.map((r: number[]) => [r[0], r[1], r[2] + 35, r[3]]) } };
    const long = { ...medium, id: 10, selectedText: 'asymptotic linear complexity', position: { ...medium.position,
      endOffset: original.position.endOffset + 18, rects: original.position.rects.map((r: number[]) => [r[0], r[1], r[2] + 100, r[3]]) } };
    // Opposite order and IDs deliberately rule out choosing the first or newest item.
    localStorage.setItem('test-highlights', JSON.stringify([long, medium, { ...original, id: 30 }]));
  });
  await page.reload(); await open(page);
  await expect(page.locator('.word-highlight')).toHaveCount(3);
  const saved = await page.evaluate(() => localStorage.getItem('test-lookups'));
  await dragSentence(page);
  await expect(page.getByRole('button', { name: '하이라이트 취소' })).toHaveCount(0);
  await page.keyboard.press('Delete'); await expect(page.locator('.word-highlight')).toHaveCount(3);
  await page.keyboard.press('Escape');
  for (const [index, id] of [30, 20, 10].entries()) {
    await clickWord(page);
    await expect(page.getByRole('button', { name: '하이라이트 취소' })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'get_saved_highlight').at(-1).args.highlightId)).toBe(id);
    await page.getByRole('button', { name: '하이라이트 취소' }).click();
    await expect(page.locator('.word-highlight')).toHaveCount(2 - index);
    expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'remove_highlights').at(-1).args.ids)).toEqual([id]);
    await page.getByRole('button', { name: '말풍선 닫기' }).last().click();
  }
  expect(await page.evaluate(() => localStorage.getItem('test-lookups'))).toBe(saved);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('AI question attaches the selection without sending, preserves a draft and model, and saves source context with the answer', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('채팅 모델', { exact: true }).selectOption('test-reasoner');
  await page.getByLabel('채팅 effort').selectOption('high');
  await page.getByLabel('논문 질문').fill('이 표현의 의미를 설명해 줘');
  await page.getByRole('button', { name: '논문 채팅 닫기' }).click();
  await page.locator('.pdf-page').nth(1).evaluate(el => el.scrollIntoView({ block: 'start' }));
  await select(page, 'asymptotic', 0, 2);
  await page.getByRole('button', { name: 'AI질문', exact: true }).click();
  const source = page.getByRole('region', { name: 'AI 질문에 첨부한 원문' });
  await expect(source).toContainText('asymptotic'); await expect(source).toContainText('2페이지');
  await expect(page.getByLabel('논문 질문')).toHaveValue('이 표현의 의미를 설명해 줘');
  await expect(page.getByLabel('논문 질문')).toBeFocused();
  await expect(page.getByLabel('채팅 모델', { exact: true })).toHaveValue('test-reasoner');
  await expect(page.getByLabel('채팅 effort')).toHaveValue('high');
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper'))).toHaveLength(0);
  // Moving the reader must not change the page attached to this question.
  await page.locator('.reader').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: '.tools/selection-actions-qa/ai-question.png' });
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-answer')).toContainText('복잡도'); await expect(source).toHaveCount(0);
  const request = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'ask_paper').args.request);
  expect(request.currentPage).toBe(2); expect(request.question).toContain('asymptotic'); expect(request.question).toContain('이 표현의 의미');
  expect(request.question).toContain('PDF 2페이지'); expect(request.context).toContain('[p. 2;');
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-question')).toContainText('asymptotic');
  await expect(page.locator('.chat-question')).toContainText('PDF 2페이지');
  await expect(page.getByRole('region', { name: 'AI 질문에 첨부한 원문' })).toHaveCount(0);
});

test('AI source can be removed or replaced, and a failed mid-answer question keeps its source and draft for retry', async ({ page }) => {
  await installBackend(page); await open(page); await dragSentence(page);
  const selected = await page.evaluate(() => window.getSelection()!.toString());
  await page.getByRole('button', { name: 'AI질문', exact: true }).click();
  const source = page.getByRole('region', { name: 'AI 질문에 첨부한 원문' });
  await expect(source.locator('blockquote')).toHaveText(selected);
  await page.getByLabel('논문 질문').fill('전체 내용을 설명해 줘');
  await page.getByRole('button', { name: '선택한 원문 첨부 해제' }).click(); await expect(source).toHaveCount(0);
  await expect(page.getByLabel('논문 질문')).toHaveValue('전체 내용을 설명해 줘');
  await page.evaluate(() => { (window as any).__chatDelay = 30000; (window as any).__steerFail = true; });
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '답변 중단' })).toBeEnabled();
  await select(page); await page.getByRole('button', { name: 'AI질문', exact: true }).click();
  await expect(source).toContainText('asymptotic');
  await select(page, 'complexity'); await page.getByRole('button', { name: 'AI질문', exact: true }).click();
  await expect(source.locator('blockquote')).toHaveText('complexity');
  await page.getByLabel('논문 질문').fill('이 단어도 설명해 줘');
  await page.getByRole('button', { name: '추가 질문 보내기' }).click();
  await expect(page.getByLabel('논문 질문')).toHaveValue('이 단어도 설명해 줘'); await expect(source).toContainText('complexity');
  await page.evaluate(() => { (window as any).__steerFail = false; });
  await page.getByRole('button', { name: '추가 질문 보내기' }).click();
  await expect(source).toHaveCount(0); await expect(page.getByLabel('논문 질문')).toHaveValue('');
  await expect(page.locator('.chat-question').last()).toContainText('complexity');
  await page.getByRole('button', { name: '답변 중단' }).click();
  await expect(page.locator('.chat-exchange')).toContainText('답변 중단됨');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-chat-paper-a')!)[0].followups[0])).toContain('PDF 1페이지');
});

test('translation width changes preserve manual zoom and only track width when fit was explicitly enabled', async ({ page }) => {
  await installBackend(page); await open(page);
  const fit = page.getByRole('button', { name: '페이지 너비 맞춤' });
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.zoom-controls span')).toHaveText('150%');
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await expect(fit).toHaveAttribute('aria-pressed', 'false');
  const handle = page.getByRole('separator', { name: '1페이지 번역창 너비 조절' });
  const initial = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus(); await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 20));
  await expect(page.locator('.zoom-controls span')).toHaveText('150%');
  await expect(fit).toHaveAttribute('aria-pressed', 'false');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 100, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initial + 20);
  await expect(page.locator('.zoom-controls span')).toHaveText('150%');
  await expect(fit).toHaveAttribute('aria-pressed', 'false');
  await fit.click(); await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await handle.focus(); await page.keyboard.press('ArrowRight');
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
