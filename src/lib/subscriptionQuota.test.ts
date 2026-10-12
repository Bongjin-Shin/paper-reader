import { expect, it } from 'vitest';
import { quotaResetText, quotaResetTime, quotaWindowLabel } from './subscriptionQuota';

it('uses the reset timestamp, not the seven-day allowance period, for the countdown', () => {
  const now = Date.parse('2026-10-12T10:00:00+09:00');
  const reset = Date.parse('2026-10-14T13:05:00+09:00') / 1000;
  expect(quotaWindowLabel(10080, true)).toBe('주간');
  expect(quotaResetText(reset, now)).toBe('2일 3시간 5분 후 초기화');
  expect(quotaResetText(reset, now + 86400000)).toBe('1일 3시간 5분 후 초기화');
  expect(quotaResetText(reset, Date.parse('2026-10-14T04:04:01Z'))).toBe('1분 후 초기화');
});

it('handles the exact boundary, expired readings and absent/invalid reset times without inventing a new allowance', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  expect(quotaResetText(now / 1000 + 86400, now)).toBe('1일 후 초기화');
  expect(quotaResetText(now / 1000, now)).toBe('초기화 시각 경과 · 갱신 확인 중');
  expect(quotaResetText(now / 1000 - 3600, now)).toBe('초기화 시각 경과 · 갱신 확인 중');
  for (const value of [null, 0, -1, NaN, Infinity, 1e30]) {
    expect(quotaResetTime(value)).toBeNull();
    expect(quotaResetText(value, now)).toBe('초기화 시각 정보 없음');
  }
});
