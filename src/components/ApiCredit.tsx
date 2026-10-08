import { useEffect, useRef, useState } from 'react';
import { errorMessage, getApiUsage, isTauri, setInitialCredit } from '../lib/backend';
import type { UsageSummary } from '../types';

export function ApiCredit({ revision }: { revision: number }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [credit, setCredit] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    const id = ++sequence.current;
    void getApiUsage().then(result => { if (id === sequence.current) { setUsage(result); setError(''); } })
      .catch(error => { if (id === sequence.current) setError(errorMessage(error)); });
    return () => { sequence.current++; };
  }, [revision, refresh]);
  useEffect(() => {
    if (!expanded) return;
    const click = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('pointerdown', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', click); document.removeEventListener('keydown', key); };
  }, [expanded]);

  const balance = error ? null : usage?.estimatedBalanceUsd;
  return <div className="api-credit" ref={root}>
    <button className="api-credit-toggle" aria-label="API 예상 잔액 설정" aria-expanded={expanded}
      title="Estimated · 초기 크레딧에서 이 앱의 사용 비용만 차감한 추정치입니다."
      onClick={() => { setCredit(usage?.initialCreditUsd?.toFixed(2) ?? ''); setExpanded(value => !value); }}>
      <span>{balance == null ? 'API ~—' : `API ~$${balance.toFixed(2)}`}</span><small>Estimated</small>
    </button>
    {expanded && <form className="credit-panel" aria-label="API 초기 크레딧 설정" onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      setSaving(true); setError('');
      try {
        await setInitialCredit(credit);
        sequence.current++;
        setRefresh(value => value + 1);
        setExpanded(false);
      }
      catch (error) { setError(errorMessage(error)); }
      finally { setSaving(false); }
    }}>
      <strong>API 예상 잔액</strong>
      <p>OpenAI 계정의 실제 잔액이 아닙니다. 초기 크레딧에서 이 앱의 누적 비용만 차감합니다.</p>
      <label>초기 크레딧 (USD)<input type="number" min="0" max="1000000" step="0.01" required value={credit}
        onChange={event => setCredit(event.target.value)} autoFocus /></label>
      <p className="credit-total">앱 누적 비용: ${usage?.totalCostUsd.toFixed(6) ?? '—'}</p>
      {usage && <p className="credit-rates">1M tokens · 입력 ${usage.pricing.inputNanoUsdPerToken / 1000} · 캐시 입력 ${usage.pricing.cachedInputNanoUsdPerToken / 1000} · 캐시 쓰기 ${usage.pricing.cacheWriteNanoUsdPerToken / 1000} · 출력 ${usage.pricing.outputNanoUsdPerToken / 1000}</p>}
      {!!usage?.estimatedCalls && <p>토큰 사용량이 누락된 {usage.estimatedCalls}건은 UTF-8 바이트 수로 보수적으로 추산했습니다.</p>}
      <p>초기 금액을 수정해도 누적 비용은 유지됩니다.</p>
      {error && <p role="alert" className="bubble-error">{error}</p>}
      <button className="open-button" disabled={saving || !isTauri()}>{saving ? '저장 중…' : '저장'}</button>
    </form>}
  </div>;
}
