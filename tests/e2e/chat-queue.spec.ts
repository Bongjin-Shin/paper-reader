import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, chooseChatOption } from './helpers';

async function chat(page: Page, readyDelay = 0, provider = 'chatgpt') {
  await installBackend(page); await open(page);
  await page.evaluate(delay => {
    (window as any).__chatDelay = 30000; (window as any).__chatStreaming = true;
    (window as any).__chatReadyDelay = delay;
    (window as any).__chatMarkdown = '기존 질문에 대한 답변을 끝까지 작성합니다.';
  }, readyDelay);
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await chooseChatOption(page, '채팅 연결', provider === 'claude' ? 'Claude' : 'ChatGPT');
  await page.getByLabel('논문 질문').fill('첫 질문');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
}
async function enqueue(page: Page, question: string) {
  await page.getByLabel('논문 질문').fill(question); await page.getByLabel('논문 질문').press('Enter');
  await expect(page.getByLabel('대기 중인 질문')).toContainText(question);
}
const asks = (page: Page) => page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper').map((c: any) => c.args.request.question));
const finish = (page: Page) => page.evaluate(() => (window as any).__liveChat.finish());
const noControl = async (page: Page) => expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ['steer_paper_chat', 'stop_paper_chat'].includes(c.command)))).toHaveLength(0);

for (const provider of ['chatgpt', 'claude']) test(`${provider}: default followups wait for the full answer, run FIFO and preserve the unsent draft`, async ({ page }) => {
  await chat(page, 0, provider);
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  await enqueue(page, '둘째 질문'); await enqueue(page, '셋째 질문'); await enqueue(page, '삭제할 질문');
  await page.getByRole('button', { name: '대기 질문 3 삭제' }).click();
  await page.getByLabel('논문 질문').fill('둘째 질문');
  expect(await asks(page)).toEqual(['첫 질문']); await noControl(page);
  await expect(page.locator('.chat-answer')).toHaveText('기존 질문에 대한 답변을 끝까지 작성합니다.');
  await page.screenshot({ path: `test-results/chat-queue-${provider}.png` });
  await finish(page);
  await expect.poll(() => asks(page)).toEqual(['첫 질문', '둘째 질문']);
  await expect(page.locator('.chat-exchange').first()).not.toContainText('답변 중단됨');
  await expect(page.getByLabel('논문 질문')).toHaveValue('둘째 질문');
  await page.getByRole('button', { name: '논문 채팅 닫기' }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByLabel('대기 중인 질문')).toContainText('셋째 질문');
  await finish(page);
  await expect.poll(() => asks(page)).toEqual(['첫 질문', '둘째 질문', '셋째 질문']);
  await finish(page);
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('대기 중인 질문')).toHaveCount(0); await noControl(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-chat-paper-a')!));
  expect(saved.map((row: any) => [row.question, row.parentId, row.interrupted, row.followups])).toEqual([
    ['첫 질문', null, false, []], ['둘째 질문', 1, false, []], ['셋째 질문', 2, false, []],
  ]);
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-question')).toHaveText(['첫 질문', '둘째 질문', '셋째 질문']);
});

test('questions can wait during preparation; they do not steer as soon as the model becomes ready', async ({ page }) => {
  await chat(page, 1000); await enqueue(page, '준비 중 추가 질문');
  await expect(page.getByRole('button', { name: '대기 질문 1 바로 보내기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  expect(await asks(page)).toEqual(['첫 질문']); await noControl(page);
  await finish(page); await expect.poll(() => asks(page)).toEqual(['첫 질문', '준비 중 추가 질문']);
});

test('stop pauses the queue, and a failed queued request can retry without losing questions or the draft', async ({ page }) => {
  await chat(page); await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  await enqueue(page, '둘째 질문'); await enqueue(page, '셋째 질문');
  await page.getByRole('button', { name: '답변 중단', exact: true }).click();
  await expect(page.locator('.chat-exchange').first()).toContainText('답변 중단됨');
  expect(await asks(page)).toEqual(['첫 질문']);
  await page.getByLabel('논문 질문').fill('아직 보내지 않은 초안');
  await page.evaluate(() => { (window as any).__chatFail = true; });
  await page.getByRole('button', { name: '대기 질문 1 바로 보내기' }).click();
  await expect(page.getByRole('alert')).toContainText('채팅 연결 실패');
  await expect(page.getByLabel('대기 중인 질문')).toContainText('둘째 질문');
  await expect(page.getByLabel('대기 중인 질문')).toContainText('셋째 질문');
  await expect(page.getByLabel('논문 질문')).toHaveValue('아직 보내지 않은 초안');
  expect(await asks(page)).toEqual(['첫 질문', '둘째 질문']);
  await page.evaluate(() => { (window as any).__chatFail = false; (window as any).__chatDelay = 0; });
  await page.getByRole('button', { name: '대기 질문 1 바로 보내기' }).click();
  await expect.poll(() => asks(page)).toEqual(['첫 질문', '둘째 질문', '둘째 질문', '셋째 질문']);
  await expect(page.getByLabel('대기 중인 질문')).toHaveCount(0);
  await expect(page.getByLabel('논문 질문')).toHaveValue('아직 보내지 않은 초안');
  await expect(page.locator('.chat-exchange')).toHaveCount(3);
});

test('immediate send removes only the acknowledged question and cannot duplicate it when the answer finishes', async ({ page }) => {
  await chat(page); await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  await enqueue(page, '즉시 전달할 질문'); await enqueue(page, '나중에 답할 질문');
  await page.evaluate(() => { (window as any).__holdSteer = true; });
  await page.getByRole('button', { name: '대기 질문 1 바로 보내기' }).click();
  await expect(page.getByRole('button', { name: '대기 질문 1 바로 보내기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '대기 질문 1 삭제' })).toBeDisabled();
  await enqueue(page, '전송 확인 중 추가한 질문');
  await expect(page.locator('.chat-answer')).toHaveText('기존 질문에 대한 답변을 끝까지 작성합니다.');
  await finish(page);
  await expect(page.locator('.chat-exchange').first()).toContainText('즉시 전달할 질문');
  expect(await asks(page)).toEqual(['첫 질문']);
  await page.evaluate(() => (window as any).__finishSteer());
  await expect.poll(() => asks(page)).toEqual(['첫 질문', '나중에 답할 질문']);
  await expect(page.getByLabel('대기 중인 질문')).not.toContainText('즉시 전달할 질문');
  await finish(page);
  await expect.poll(() => asks(page)).toEqual(['첫 질문', '나중에 답할 질문', '전송 확인 중 추가한 질문']);
  await finish(page);
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toHaveCount(0);
  const controls = await page.evaluate(() => (window as any).__calls.filter((c: any) => ['steer_paper_chat', 'stop_paper_chat'].includes(c.command)));
  expect(controls.map((c: any) => [c.command, c.args.question])).toEqual([['steer_paper_chat', '즉시 전달할 질문']]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-chat-paper-a')!));
  expect(saved[0].followups).toEqual(['즉시 전달할 질문']); expect(saved[0].interrupted).toBe(false);
});
