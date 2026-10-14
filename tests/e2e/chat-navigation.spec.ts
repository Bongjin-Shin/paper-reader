import { expect, test, type Page } from '@playwright/test';
import { installBackend, open } from './helpers';

const nav = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const finish = (page: Page) => page.evaluate(() => (window as any).__liveChat.finish());
const asks = (page: Page) => page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper').map((c: any) => [c.args.request.paperId, c.args.request.question]));
async function start(page: Page) {
  await installBackend(page); await open(page); await nav(page, '논문 채팅');
  await page.evaluate(() => {
    (window as any).__chatStreaming = true; (window as any).__chatDelay = 60000;
    (window as any).__chatMarkdown = '진행 중인 논문 A 답변';
  });
  await page.getByLabel('논문 질문').fill('논문 A 첫 질문');
  await nav(page, '질문 보내기');
  await expect(page.locator('.chat-answer')).toHaveText('진행 중인 논문 A 답변');
  await page.getByLabel('논문 질문').fill('논문 A 대기 질문');
  await page.getByLabel('논문 질문').press('Enter');
  await page.getByLabel('논문 질문').fill('논문 A 작성 중 초안');
}
async function openB(page: Page) {
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/another.pdf'] }));
  await expect(page.locator('.document-title')).toHaveText('another.pdf');
  if (!(await page.getByLabel('논문 질문').isVisible())) await nav(page, '논문 채팅');
  await expect(page.getByLabel('논문 질문')).toHaveValue('');
  await expect(page.locator('.chat-exchange')).toHaveCount(0);
  await page.getByLabel('논문 질문').fill('논문 B만의 초안');
}
async function reopen(page: Page, title: string) {
  await nav(page, 'Library'); await nav(page, title);
  if (!(await page.getByLabel('논문 질문').isVisible())) await nav(page, '논문 채팅');
}

test('Library, Vocabulary and a closed chat keep the stream, FIFO queue and draft', async ({ page }) => {
  await start(page);
  await nav(page, 'Library'); await nav(page, 'Vocabulary'); await nav(page, 'PDF Reader');
  await expect(page.locator('.chat-answer')).toHaveText('진행 중인 논문 A 답변');
  await expect(page.getByLabel('논문 질문')).toHaveValue('논문 A 작성 중 초안');
  await expect(page.getByLabel('대기 중인 질문')).toContainText('논문 A 대기 질문');
  await nav(page, '논문 채팅 닫기'); await finish(page);
  await expect.poll(() => asks(page)).toEqual([['paper-a', '논문 A 첫 질문'], ['paper-a', '논문 A 대기 질문']]);
  await finish(page); await nav(page, '논문 채팅');
  await expect(page.locator('.chat-exchange')).toHaveCount(2);
  await expect(page.getByLabel('논문 질문')).toHaveValue('논문 A 작성 중 초안');
});

test('switching papers during a response restores the live session and keeps drafts isolated', async ({ page }) => {
  await start(page); await openB(page); await reopen(page, 'test-paper.pdf');
  await expect(page.locator('.chat-answer')).toHaveText('진행 중인 논문 A 답변');
  await expect(page.getByLabel('논문 질문')).toHaveValue('논문 A 작성 중 초안');
  await expect(page.getByLabel('대기 중인 질문')).toContainText('논문 A 대기 질문');
  await finish(page);
  await expect.poll(() => asks(page)).toEqual([['paper-a', '논문 A 첫 질문'], ['paper-a', '논문 A 대기 질문']]);
  await finish(page); await expect(page.locator('.chat-exchange')).toHaveCount(2);
  await reopen(page, 'another.pdf');
  await expect(page.getByLabel('논문 질문')).toHaveValue('논문 B만의 초안');
  await expect(page.locator('.chat-exchange')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'stop_paper_chat'))).toHaveLength(0);
});

test('answers and queued requests finish while viewing another paper, then survive restart', async ({ page }) => {
  await start(page); await openB(page); await finish(page);
  await expect.poll(() => asks(page)).toEqual([['paper-a', '논문 A 첫 질문'], ['paper-a', '논문 A 대기 질문']]);
  await finish(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-chat-paper-a') || '[]').length)).toBe(2);
  await expect(page.locator('.chat-exchange')).toHaveCount(0);
  await reopen(page, 'test-paper.pdf');
  await expect(page.locator('.chat-question')).toHaveText(['논문 A 첫 질문', '논문 A 대기 질문']);
  await expect(page.getByLabel('논문 질문')).toHaveValue('논문 A 작성 중 초안');
  await page.reload(); await open(page); await nav(page, '논문 채팅');
  await expect(page.locator('.chat-question')).toHaveText(['논문 A 첫 질문', '논문 A 대기 질문']);
});
