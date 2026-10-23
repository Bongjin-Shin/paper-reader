import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatIcons';
import type { SubscriptionUsage } from '../types';
import { getSubscriptionUsage } from '../lib/backend';
import { quotaResetText, quotaResetTime, quotaWindowLabel } from '../lib/subscriptionQuota';

export function SubscriptionQuota({ revision, provider = 'chatgpt' }: { revision: number; provider?: 'chatgpt' | 'claude' }) {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null), [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const reset = () => { setUsage(null); setError(false); setRefresh(n => n + 1); };
    window.addEventListener(`${provider}-connection-changed`, reset);
    return () => window.removeEventListener(`${provider}-connection-changed`, reset);
  }, [provider]);
  useEffect(() => {
    let live = true, busy = false;
    const update = async () => {
      setNow(Date.now());
      if (busy) return; busy = true; setLoading(true);
      try { const result = await getSubscriptionUsage(provider); if (live) { setUsage(result); setNow(Date.now()); setError(false); } }
      catch { if (live) setError(true); } finally { busy = false; if (live) setLoading(false); }
    };
    void update(); const timer = window.setInterval(() => void update(), 30000);
    const focus = () => { void update(); };
    const visible = () => { if (document.visibilityState === 'visible') void update(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); };
  }, [revision, refresh, provider]);
  const windows = usage?.buckets.flatMap(bucket => [bucket.primary, bucket.secondary].flatMap((window, i) => {
    if (!window) return [];
    const label = quotaWindowLabel(window.windowDurationMins, i === 1);
    const time = quotaResetTime(window.resetsAt), reset = time === null ? '제공되지 않음' : new Date(time).toLocaleString('ko-KR');
    return [{ key: `${bucket.id}-${i}`, text: `${usage.buckets.length > 1 ? `${bucket.name} · ` : ''}${label} ${Number(Math.max(0, Math.min(100, 100 - window.usedPercent)).toFixed(1))}% 남음`, reset,
      countdown: quotaResetText(window.resetsAt, now) }];
  })) ?? [];
  const updated = usage?.updatedAt ? new Date(usage.updatedAt * 1000).toLocaleTimeString('ko-KR') : '';
  return <div className="chat-quota" aria-label={provider === 'claude' ? 'Claude 구독 사용량' : '구독 잔여 사용량'}>
    {windows.length ? windows.map(row => <span className="chat-quota-window" key={row.key} title={`초기화: ${row.reset}\n조회: ${updated}${error ? ' · 갱신 실패, 마지막 조회값' : ''}`}>{row.text}<span className="chat-quota-reset">{row.countdown}</span></span>)
      : <span>{error ? '구독 사용량 확인 불가' : usage ? '구독 사용량 정보 없음' : '구독 사용량 확인 중…'}</span>}
    {error && windows.length > 0 && <span>갱신 실패 · 이전 조회값</span>}
    <button type="button" disabled={loading} aria-label="구독 사용량 새로고침" onClick={() => setRefresh(n => n + 1)}><span key={refresh} className={refresh ? "quota-refresh-turn" : undefined}><ChatIcon name="refresh" /></span></button>
  </div>;
}
