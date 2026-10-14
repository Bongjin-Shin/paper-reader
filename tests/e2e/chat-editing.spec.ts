import { expect, test, type Page } from '@playwright/test';
import { installBackend, open } from './helpers';

async function chat(page: Page) {
  await installBackend(page); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '논문 질문', exact: true })).toBeEnabled();
}
async function send(page: Page, text: string, count: number) {
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill(text);
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.locator('.chat-answer')).toHaveCount(count);
  await expect(page.getByRole('button', { name: '질문 보내기', exact: true })).toBeVisible();
}

test('older questions can be edited with their later conversations preserved as switchable versions', async ({ page }) => {
  await chat(page);
  await send(page, '논문의 목적은?', 1); await send(page, '실험 조건은?', 2); await send(page, '결론은?', 3);
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('작성하던 새 질문');
  await page.locator('.chat-exchange').nth(1).getByRole('button', { name: '질문 수정', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '질문 수정', exact: true })).toHaveValue('실험 조건은?');
  await page.getByRole('textbox', { name: '질문 수정', exact: true }).fill('실험 조건과 비교 방법을 설명해줘');
  await page.screenshot({ path: 'test-results/chat-question-editor.png' });
  await page.getByRole('button', { name: '수정 후 전송', exact: true }).click();
  await expect(page.locator('.chat-question')).toHaveText(['논문의 목적은?', '실험 조건과 비교 방법을 설명해줘']);
  await expect(page.getByRole('navigation', { name: '질문 버전', exact: true })).toContainText('2 / 2');
  await expect(page.getByRole('textbox', { name: '논문 질문', exact: true })).toHaveValue('작성하던 새 질문');
  await send(page, '수정 후 이어지는 질문', 3);
  await page.getByRole('button', { name: '이전 질문 버전' }).click();
  await expect(page.locator('.chat-question')).toHaveText(['논문의 목적은?', '실험 조건은?', '결론은?']);
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.locator('.chat-question')).toHaveText(['논문의 목적은?', '실험 조건은?', '결론은?']);
  await page.getByRole('button', { name: '다음 질문 버전' }).click();
  await expect(page.locator('.chat-question')).toHaveText(['논문의 목적은?', '실험 조건과 비교 방법을 설명해줘', '수정 후 이어지는 질문']);
  await page.screenshot({ path: 'test-results/chat-question-versions.png' });
  const saved = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'select_chat_branch'));
  expect(saved).toHaveLength(1);
});

test('failed edits retain the edit draft and original conversation, and cancel does not call the model', async ({ page }) => {
  await chat(page); await send(page, '첫 질문', 1); await send(page, '이어진 질문', 2);
  await page.locator('.chat-exchange').first().getByRole('button', { name: '질문 수정', exact: true }).click();
  await page.getByRole('textbox', { name: '질문 수정', exact: true }).fill('고친 첫 질문');
  await page.evaluate(() => { (window as any).__chatFail = true; });
  await page.getByRole('button', { name: '수정 후 전송', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('채팅 연결 실패');
  await expect(page.getByRole('textbox', { name: '질문 수정', exact: true })).toHaveValue('고친 첫 질문');
  await expect(page.locator('.chat-answer')).toHaveCount(2);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.chat-question')).toHaveText(['첫 질문', '이어진 질문']);
  await expect(page.locator('.chat-versions')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper').length)).toBe(3);
});

test('steered questions are editable and interrupting a revision preserves both versions', async ({ page }) => {
  await chat(page); await page.evaluate(() => { (window as any).__chatDelay = 30000; (window as any).__chatStreaming = true; });
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('수식을 설명해줘');
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '답변 중단', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('알파의 의미도 알려줘');
  await page.getByRole('button', { name: '추가 질문 보내기', exact: true }).click();
  await page.getByRole('button', { name: '대기 질문 1 바로 보내기' }).click();
  await expect(page.locator('.chat-question').last()).toContainText('알파의 의미');
  await page.getByRole('button', { name: '답변 중단', exact: true }).click();
  await expect(page.getByRole('button', { name: '추가 질문 수정', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '추가 질문 수정', exact: true }).click();
  await page.getByRole('textbox', { name: '추가 질문 수정', exact: true }).fill('베타의 의미를 알려줘');
  await page.getByRole('button', { name: '수정 후 전송', exact: true }).click();
  await expect(page.locator('.chat-question').first()).toHaveText('수식을 설명해줘');
  await expect(page.locator('.chat-question').last()).toContainText('베타의 의미');
  await page.getByRole('button', { name: '답변 중단', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '질문 버전', exact: true })).toContainText('2 / 2');
  await page.getByRole('button', { name: '이전 질문 버전' }).click();
  await expect(page.locator('.chat-question').last()).toContainText('알파의 의미');
  const edit = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper').at(-1).args.edit);
  expect(edit).toEqual({ exchangeId: 1, followupIndex: 0 });
});

test('composer uses accessible icon controls and refresh visibly rotates once on each click', async ({ page }) => {
  await chat(page); await expect(page.getByText('Enter 전송 · Shift+Enter 줄바꿈', { exact: true })).toHaveCount(0);
  const sendButton = page.getByRole('button', { name: '질문 보내기', exact: true });
  await expect(sendButton).toHaveText(''); await expect(sendButton.locator('svg')).toHaveCount(1);
  const refresh = page.getByRole('button', { name: '구독 사용량 새로고침' });
  for (let i = 0; i < 2; i++) {
    await refresh.click();
    await expect.poll(() => refresh.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(1);
    await expect.poll(() => refresh.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  }
  await page.evaluate(() => { (window as any).__chatDelay = 30000; });
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('아이콘으로 보내기'); await sendButton.click();
  const stop = page.getByRole('button', { name: '답변 중단', exact: true });
  await expect(stop).toHaveText(''); await expect(stop.locator('svg rect')).toHaveCount(1);
  await expect(page.locator('.chat-actions > .chat-icon-button')).toHaveCount(1);
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('추가 질문');
  await expect(page.getByRole('button', { name: '추가 질문 보내기', exact: true })).toBeEnabled();
  await expect(stop).toHaveCount(0);
  await expect(page.locator('.chat-actions > .chat-icon-button')).toHaveCount(1);
  await page.getByRole('textbox', { name: '논문 질문', exact: true }).fill('');
  await expect(stop).toBeEnabled();
  await stop.click(); await expect(page.locator('.chat-exchange')).toContainText('답변 중단됨');
});
