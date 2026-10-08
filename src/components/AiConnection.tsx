import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelChatgptLogin, errorMessage, getAiProvider, getChatgptStatus, isTauri, logoutChatgpt, setAiProvider, startChatgptLogin } from '../lib/backend';
import type { AiProvider, ChatgptStatus } from '../types';
import { ApiCredit } from './ApiCredit';
import { ClaudeConnection } from './ClaudeConnection';
import { ModelPicker } from './ModelPicker';

export function AiConnection({ revision }: { revision: number }) {
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [status, setStatus] = useState<ChatgptStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    setChecking(true);
    try {
      const result = await getChatgptStatus();
      if (id === sequence.current) { setStatus(result); setError(result.error ?? ''); }
    } catch (error) { if (id === sequence.current) setError(errorMessage(error)); }
    finally { if (id === sequence.current) setChecking(false); }
  }, []);

  useEffect(() => {
    let disposed = false;
    if (isTauri()) void getAiProvider().then(value => { if (!disposed) setProvider(value); })
      .catch(error => { if (!disposed) setError(errorMessage(error)); });
    return () => { disposed = true; sequence.current++; };
  }, []);
  useEffect(() => {
    if (provider === 'chatgpt' && expanded) void refresh();
  }, [provider, expanded, refresh]);
  useEffect(() => {
    if (!status?.loginPending || busy || checking) return;
    const timer = window.setTimeout(() => { void refresh(); }, 2000);
    return () => window.clearTimeout(timer);
  }, [status, busy, checking, refresh]);
  useEffect(() => {
    if (!expanded) return;
    const click = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); toggle.current?.focus(); }
    };
    document.addEventListener('pointerdown', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', click); document.removeEventListener('keydown', key); };
  }, [expanded]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    sequence.current++; setChecking(false); setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <div className="ai-connection">
    <div className="ai-connection-control" ref={root}>
      <button ref={toggle} className="ai-connection-toggle" aria-label="번역 연결 설정" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>
        {provider === 'claude' ? <><span>Claude</span><small>구독</small></> : provider === 'chatgpt' ? <><span>ChatGPT</span><small>구독</small></> : '번역 연결'}
      </button>
      {expanded && <div className="credit-panel connection-panel" role="dialog" aria-label="번역 연결 설정">
        <strong>번역 연결</strong>
        <label>번역 방식<select aria-label="번역 방식" value={provider ?? ''} disabled={busy || !isTauri()}
          onChange={async event => {
            const next = event.target.value as AiProvider;
            setBusy(true); setError(''); sequence.current++; setChecking(false);
            try { await setAiProvider(next); setProvider(next); }
            catch (error) { setError(errorMessage(error)); }
            finally { setBusy(false); }
          }}>
          {provider === null && <option value="" disabled>설정 확인 중…</option>}
          <option value="claude">Claude 구독</option><option value="chatgpt">ChatGPT 구독</option><option value="api">OpenAI API</option>
        </select></label>
        {provider === 'claude' ? <><ClaudeConnection /><ModelPicker scope="translation" provider="claude" /><p>모델 변경은 새 번역·설명 요청에 적용됩니다. 저장된 결과는 재사용합니다.</p></> : provider === 'chatgpt' ? <>
          <p>ChatGPT 계정으로 로그인하면 플랜의 Codex 사용 한도로 번역·설명을 처리합니다. 이 앱의 API 예상 잔액에서는 차감하지 않습니다.</p>
          <p className="connection-status" role="status">{checking && !status ? '연결 확인 중…' : status?.connected
            ? `연결됨${status.planType ? ` · ${status.planType}` : ''}` : status?.loginPending ? '브라우저에서 로그인을 완료해 주세요.' : '로그인이 필요합니다.'}</p>
          {status?.installed === false && <p className="bubble-error">Codex 연결 도구가 없습니다. 앱 설치 스크립트를 다시 실행해 주세요.</p>}
          <div className="connection-actions">
            {status?.connected ? <button disabled={busy || checking} onClick={() => { void run(logoutChatgpt); }}>로그아웃</button>
              : <button className="open-button" disabled={busy || checking || status?.installed === false}
                onClick={() => { void run(startChatgptLogin); }}>{busy ? '처리 중…' : status?.loginPending ? '로그인 페이지 다시 열기' : 'ChatGPT 로그인'}</button>}
            {status?.loginPending && <button disabled={busy || checking} onClick={() => { void run(cancelChatgptLogin); }}>로그인 취소</button>}
            <button disabled={busy || checking} onClick={() => { void refresh(); }}>연결 확인</button>
          </div>
          {status?.connected && <ModelPicker scope="translation" />}
          <p>모델 변경은 새 번역·설명 요청에 적용됩니다. 저장된 결과는 재사용합니다.</p>
        </> : <p>기존 API 키로 번역·설명을 처리하며, 사용량에 따라 별도로 과금됩니다. 초기 크레딧은 API 예상 잔액에서 설정할 수 있습니다.</p>}
        {error && <p role="alert" className="bubble-error">{error}</p>}
        <button className="connection-close" onClick={() => { setExpanded(false); toggle.current?.focus(); }}>닫기</button>
      </div>}
    </div>
    {provider === 'api' && <ApiCredit revision={revision} />}
  </div>;
}
