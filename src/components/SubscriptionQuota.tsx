import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatIcons';
import type { SubscriptionUsage } from '../types';
import { getSubscriptionUsage } from '../lib/backend';

export function SubscriptionQuota({ revision, provider = 'chatgpt' }: { revision: number; provider?: 'chatgpt' | 'claude' }) {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null), [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const reset = () => { setUsage(null); setError(false); setRefresh(n => n + 1); };
    window.addEventListener(`${provider}-connection-changed`, reset);
    return () => window.removeEventListener(`${provider}-connection-changed`, reset);
  }, [provider]);
  useEffect(() => {
    let live = true, busy = false;
    const update = async () => {
      if (busy) return; busy = true; setLoading(true);
      try { const result = await getSubscriptionUsage(provider); if (live) { setUsage(result); setError(false); } }
      catch { if (live) setError(true); } finally { busy = false; if (live) setLoading(false); }
    };
    void update(); const timer = window.setInterval(() => void update(), 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [revision, refresh, provider]);
  const windows = usage?.buckets.flatMap(bucket => [bucket.primary, bucket.secondary].flatMap((window, i) => {
    if (!window) return [];
    const minutes = window.windowDurationMins;
    const label = minutes ? minutes >= 1440 ? `${Math.round(minutes / 1440)}일` : minutes >= 60 ? `${minutes / 60}시간` : `${minutes}분` : i ? '주간' : '단기';
    const reset = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString('ko-KR') : '제공되지 않음';
    return [{ key: `${bucket.id}-${i}`, text: `${usage.buckets.length > 1 ? `${bucket.name} · ` : ''}${label} ${Number(Math.max(0, Math.min(100, 100 - window.usedPercent)).toFixed(1))}% 남음`, reset }];
  })) ?? [];
  const updated = usage?.updatedAt ? new Date(usage.updatedAt * 1000).toLocaleTimeString('ko-KR') : '';
  return <div className="chat-quota" aria-label={provider === 'claude' ? 'Claude 구독 사용량' : '구독 잔여 사용량'}>
    {windows.length ? windows.map(row => <span key={row.key} title={`초기화: ${row.reset}\n조회: ${updated}${error ? ' · 갱신 실패, 마지막 조회값' : ''}`}>{row.text}</span>)
      : <span>{error ? '구독 사용량 확인 불가' : usage ? '구독 사용량 정보 없음' : '구독 사용량 확인 중…'}</span>}
    {error && windows.length > 0 && <span>갱신 실패 · 이전 조회값</span>}
    <button type="button" disabled={loading} aria-label="구독 사용량 새로고침" title="정확한 잔여 토큰 수 대신 구독 사용 한도의 남은 비율입니다." onClick={() => setRefresh(n => n + 1)}><span key={refresh} className={refresh ? "quota-refresh-turn" : undefined}><ChatIcon name="refresh" /></span></button>
  </div>;
}
