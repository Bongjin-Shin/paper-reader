import { expect, test } from '@playwright/test';
import { installBackend, open } from './helpers';

test('Claude translation and chat have independent providers, models and effort across restart', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { localStorage.setItem('test-claude-connected','true'); localStorage.setItem('test-chatgpt-connected','true'); });
  await page.getByRole('button',{name:'번역 연결 설정'}).click();
  await page.getByLabel('번역 방식').selectOption('claude');
  await expect(page.getByText('Claude 연결됨 · pro')).toBeVisible();
  await expect(page.getByLabel('번역 모델',{exact:true})).toHaveValue('sonnet');
  await page.getByLabel('번역 effort').selectOption('medium');
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
  await expect(page.getByLabel('채팅 연결')).toHaveValue('chatgpt');
  await page.getByLabel('채팅 연결').selectOption('claude');
  await page.getByLabel('채팅 모델',{exact:true}).selectOption('opus[1m]');
  await page.getByLabel('채팅 effort').selectOption('max');
  await expect(page.getByLabel('Claude 구독 사용량')).toContainText('5시간 76.5% 남음');
  await expect(page.getByLabel('Claude 구독 사용량')).toContainText('7일 40% 남음');
  await page.getByLabel('구독 사용량 새로고침').click();
  await expect(page.locator('.quota-refresh-turn')).toHaveCount(1);
  await page.getByLabel('논문 질문').fill('실험을 설명해줘'); await page.getByRole('button',{name:'질문 보내기',exact:true}).click();
  await expect(page.locator('.chat-exchange').last()).toContainText('opus[1m] · max');
  await page.getByLabel('채팅 연결').selectOption('chatgpt');
  await expect(page.getByLabel('채팅 모델',{exact:true})).toHaveValue('');
  await page.getByLabel('채팅 연결').selectOption('claude');
  await expect(page.getByLabel('채팅 모델',{exact:true})).toHaveValue('opus[1m]');
  await page.reload(); await open(page); await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
  await expect(page.getByLabel('채팅 연결')).toHaveValue('claude');
  await expect(page.getByLabel('채팅 effort')).toHaveValue('max');
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('test-claude-models')!));
  expect(preferences.translationModel).toBe('sonnet'); expect(preferences.translationEffort).toBe('medium');
  await page.screenshot({path:'test-results/claude-chat.png'});
});

test('Claude connection installs the helper then signs in without an API key', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__claudeMissing = true; });
  await page.getByRole('button',{name:'번역 연결 설정'}).click(); await page.getByLabel('번역 방식').selectOption('claude');
  await page.getByRole('button',{name:'Claude 연결 도구 설치'}).click();
  await page.getByRole('button',{name:'Claude 로그인',exact:true}).click();
  await expect(page.getByText('기본 브라우저에서 Claude 로그인을 완료해 주세요.')).toBeVisible();
  await page.getByRole('button',{name:'Claude 로그인 취소'}).click();
  await page.getByRole('button',{name:'Claude 로그인',exact:true}).click();
  await page.evaluate(() => localStorage.setItem('test-claude-connected','true'));
  await page.getByRole('button',{name:'Claude 연결 확인'}).click();
  await expect(page.getByText('Claude 연결됨 · pro')).toBeVisible();
  await page.getByRole('button',{name:'Claude 로그아웃'}).click();
  await expect(page.getByRole('button',{name:'Claude 로그인',exact:true})).toBeVisible();
});

test('Claude quota keeps labeled last result on error and clears on logout or provider switch', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => localStorage.setItem('test-claude-connected','true'));
  await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
  await page.getByLabel('채팅 연결').selectOption('claude');
  const quota = page.getByLabel('Claude 구독 사용량');
  await expect(quota).toContainText('5시간 76.5% 남음');
  await expect(quota.getByText('5시간 76.5% 남음')).toHaveAttribute('title', /초기화: .*\n조회:/);
  await page.evaluate(() => { (window as any).__claudeQuotaError = true; });
  await page.getByLabel('구독 사용량 새로고침').click();
  await expect(quota).toContainText('갱신 실패 · 이전 조회값');
  await expect(quota).toContainText('5시간 76.5% 남음');
  await page.getByLabel('채팅 연결').selectOption('chatgpt');
  await expect(page.getByLabel('구독 잔여 사용량')).toContainText('5시간 75% 남음');
  await expect(page.getByText('5시간 76.5% 남음')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__claudeQuotaError = false; });
  await page.getByLabel('채팅 연결').selectOption('claude');
  await expect(quota).toContainText('5시간 76.5% 남음');
  await page.getByRole('button',{name:'Claude 로그아웃'}).click();
  await expect(quota).toContainText('구독 사용량 정보 없음');
  await expect(quota).not.toContainText('% 남음');
});

test('Claude chat keeps streaming, additional questions and stop', async ({ page }) => {
  await installBackend(page); await open(page); await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
  await page.getByLabel('채팅 연결').selectOption('claude');
  await page.evaluate(() => { (window as any).__chatDelay=1200; (window as any).__chatStreaming=true; });
  await page.getByLabel('논문 질문').fill('첫 질문'); await page.getByRole('button',{name:'질문 보내기',exact:true}).click();
  await expect(page.getByLabel('채팅 연결')).toBeDisabled();
  await expect(page.getByRole('button',{name:'답변 중단'})).toBeEnabled();
  await page.getByLabel('논문 질문').fill('추가 질문'); await page.getByRole('button',{name:'추가 질문 보내기'}).click();
  await expect(page.locator('.chat-question').last()).toContainText('추가 질문');
  await page.getByRole('button',{name:'답변 중단'}).click();
  await expect(page.locator('.chat-exchange').last()).toContainText('답변 중단됨');
  await expect(page.getByLabel('채팅 연결')).toBeEnabled();
  await expect(page.locator('.chat-actions button')).toHaveCount(1);
});

test('Claude models without effort support disable that control and reset old effort', async ({ page }) => {
  await installBackend(page); await open(page); await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
  await page.getByLabel('채팅 연결').selectOption('claude');
  await page.getByLabel('채팅 모델',{exact:true}).selectOption('sonnet'); await page.getByLabel('채팅 effort').selectOption('high');
  await page.getByLabel('채팅 모델',{exact:true}).selectOption('haiku');
  await expect(page.getByLabel('채팅 effort')).toBeDisabled(); await expect(page.getByLabel('채팅 effort')).toHaveValue('');
});
