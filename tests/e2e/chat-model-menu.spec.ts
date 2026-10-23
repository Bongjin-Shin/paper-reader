import { expect, test } from '@playwright/test';
import { installBackend, open, chooseChatOption } from './helpers';

for (const viewport of [{ width: 1200, height: 900 }, { width: 680, height: 600 }]) {
  test(`all chat selectors open above their controls within the ${viewport.width}px window`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBackend(page); await open(page);
    await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
    await page.getByLabel('논문 질문').fill('작성 중인 질문은 보내지 않기');
    for (const label of ['채팅 연결', '채팅 모델', '채팅 effort']) {
      const control = page.getByRole('combobox', { name: label, exact: true });
      await expect(control).toBeEnabled(); await control.click();
      const menu = page.getByRole('listbox', { name: label, exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('option', { name: /기본|default/i })).toHaveCount(0);
      const bounds = (await menu.boundingBox())!, anchor = (await control.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y);
      expect(bounds.y).toBeGreaterThanOrEqual(8);
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(await menu.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + 20, rect.y + rect.height / 2));
      })).toBe(true);
      await page.screenshot({ path: `test-results/chat-menu-${viewport.width}-${label}.png` });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0); await expect(control).toBeFocused();
    }
    await page.getByRole('combobox', { name: '채팅 모델', exact: true }).click();
    await page.locator('.paper-chat > header strong').click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByLabel('논문 질문')).toHaveValue('작성 중인 질문은 보내지 않기');
    expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper'))).toHaveLength(0);
  });
}

test('old automatic preferences show known values while Claude default aliases are not offered', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '채팅 모델', exact: true })).toHaveAttribute('data-value', 'gpt-5.6-luna');
  await expect(page.getByRole('combobox', { name: '채팅 effort', exact: true })).toHaveAttribute('data-value', 'low');
  await page.evaluate(() => {
    localStorage.setItem('test-claude-models', JSON.stringify({ translationModel: 'sonnet', translationEffort: 'medium', chatModel: 'default', chatEffort: '' }));
    const backend = (window as any).__TAURI_INTERNALS__, invoke = backend.invoke;
    backend.invoke = async (command: string, args: unknown) => {
      const result = await invoke(command, args);
      return command === 'get_claude_models'
        ? [{ model: 'default', displayName: 'Claude · Default', efforts: [], defaultEffort: '', isDefault: true },
          ...result.map((model: any) => ({ ...model, isDefault: false }))] : result;
    };
  });
  await chooseChatOption(page, '채팅 연결', 'Claude');
  const model = page.getByRole('combobox', { name: '채팅 모델', exact: true });
  await expect(model).toContainText('모델 선택');
  await model.click();
  await expect(page.getByRole('option', { name: /기본|default/i })).toHaveCount(0);
  await page.getByRole('option', { name: 'Claude · Sonnet', exact: true }).click();
  const effort = page.getByRole('combobox', { name: '채팅 effort', exact: true });
  await expect(effort).toBeEnabled(); await expect(effort).toContainText('effort 선택');
  await chooseChatOption(page, '채팅 effort', 'high');
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('test-claude-models')!));
  expect(preferences).toEqual({ translationModel: 'sonnet', translationEffort: 'medium', chatModel: 'sonnet', chatEffort: 'high' });
});

test('a long model list scrolls above the composer and supports keyboard selection without sending a draft', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await installBackend(page); await open(page);
  await page.evaluate(() => {
    const backend = (window as any).__TAURI_INTERNALS__, invoke = backend.invoke;
    backend.invoke = (command: string, args: unknown) => command === 'get_chatgpt_models'
      ? Promise.resolve(Array.from({ length: 50 }, (_, i) => ({ model: `model-${i}`, displayName: `Model ${i}`,
        efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: i === 0 }))) : invoke(command, args);
  });
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('논문 질문').fill('보내지 않은 초안');
  const control = page.getByRole('combobox', { name: '채팅 모델', exact: true });
  await expect(control).toBeEnabled(); await control.focus(); await page.keyboard.press('ArrowUp');
  const menu = page.getByRole('listbox', { name: '채팅 모델', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await expect.poll(() => menu.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(menu.getByRole('option', { name: 'Model 49', exact: true })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(control).toHaveAttribute('data-value', 'model-49');
  await expect(menu).toHaveCount(0);
  await expect(control).toBeEnabled(); await control.click();
  await page.keyboard.press('Home'); await page.keyboard.press('Escape');
  await expect(control).toHaveAttribute('data-value', 'model-49');
  await control.click(); await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(page.getByLabel('논문 질문')).toHaveValue('보내지 않은 초안');
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'ask_paper'))).toHaveLength(0);
});
