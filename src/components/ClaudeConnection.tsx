import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelClaudeLogin, errorMessage, getClaudeStatus, installClaude, logoutClaude, startClaudeLogin } from '../lib/backend';
import type { ChatgptStatus } from '../types';

export function ClaudeConnection({ disabled = false }: { disabled?: boolean }) {
  const [status, setStatus] = useState<ChatgptStatus | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const alive = useRef(true), sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try { const next = await getClaudeStatus(); if (alive.current && sequence.current === id) { setStatus(next); setError(next.error ?? ''); } }
    catch (e) { if (alive.current && sequence.current === id) setError(errorMessage(e)); }
  }, []);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; sequence.current++; }; }, [refresh]);
  useEffect(() => { if (status) window.dispatchEvent(new Event('claude-connection-changed')); }, [status?.connected]);
  useEffect(() => {
    if (!status?.loginPending || busy) return;
    const timer = window.setTimeout(() => void refresh(), 2000);
    return () => window.clearTimeout(timer);
  }, [status, busy, refresh]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy || disabled) return;
    setBusy(label); setError(''); sequence.current++;
    try { await action(); await refresh(); window.dispatchEvent(new Event('claude-connection-changed')); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(''); }
  };
  return <div className="claude-connection">
    <p hidden={status?.connected}>공식 Claude Code로 구독 계정을 연결합니다. API 키 없이 사용하며 Claude 계정의 이용 한도가 적용됩니다.</p>
    <p role="status" className="connection-status">{busy || (status?.connected ? `Claude 연결됨${status.planType ? ` · ${status.planType}` : ''}` : status?.loginPending ? '기본 브라우저에서 Claude 로그인을 완료해 주세요.' : status ? 'Claude 로그인이 필요합니다.' : 'Claude 연결 확인 중…')}</p>
    <div className="connection-actions">
      {status?.installed === false ? <button disabled={disabled || !!busy} onClick={() => void run('Claude 연결 도구 다운로드 중…', installClaude)}>Claude 연결 도구 설치</button>
        : status?.connected ? <button disabled={disabled || !!busy} onClick={() => void run('Claude 로그아웃 중…', logoutClaude)}>Claude 로그아웃</button>
        : <button className="open-button" disabled={disabled || !!busy || !status || status.loginPending} onClick={() => void run('Claude 로그인 시작 중…', startClaudeLogin)}>Claude 로그인</button>}
      {status?.installed && !status.connected && !status.loginPending && <button disabled={disabled || !!busy} onClick={() => void run('Claude 연결 도구 다운로드 중…', installClaude)}>Claude 연결 도구 복구</button>}
      {status?.loginPending && <button disabled={disabled || !!busy} onClick={() => void run('로그인 취소 중…', cancelClaudeLogin)}>Claude 로그인 취소</button>}
      <button disabled={disabled || !!busy} onClick={() => void refresh()}>Claude 연결 확인</button>
    </div>
    {status?.installed === false && <p>처음 한 번 공식 연결 도구 약 340MB를 다운로드합니다.</p>}
    {error && <p className="bubble-error" role="alert">{error}</p>}
  </div>;
}
