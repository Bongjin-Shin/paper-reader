import { useEffect, useState } from 'react';
import { errorMessage, getChatgptModels, getClaudeModels, getModelPreferences, setModelPreference } from '../lib/backend';
import type { ModelInfo } from '../types';

export function ModelPicker({ scope, disabled = false, provider = 'chatgpt' }: { scope: 'translation' | 'chat'; disabled?: boolean; provider?: 'chatgpt' | 'claude' }) {
  const [models, setModels] = useState<ModelInfo[]>([]), [model, setModel] = useState(''), [effort, setEffort] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, refresh] = useState(0);
  useEffect(() => { if (provider !== 'claude') return; const update = () => refresh(n => n + 1); window.addEventListener('claude-connection-changed', update); return () => window.removeEventListener('claude-connection-changed', update); }, [provider]);
  const label = scope === 'translation' ? '번역 모델' : '채팅 모델';
  useEffect(() => {
    let live = true; setBusy(true); setError('');
    void Promise.all([provider === 'claude' ? getClaudeModels() : getChatgptModels(), getModelPreferences(provider)]).then(([catalog, preferences]) => {
      if (!live) return;
      setModels(catalog); setModel(scope === 'translation' ? preferences.translationModel : preferences.chatModel);
      setEffort(scope === 'chat' ? preferences.chatEffort : preferences.translationEffort ?? '');
    }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [scope, revision, provider]);
  const selected = models.find(m => m.model === model) ?? (!model ? models.find(m => m.isDefault) ?? models[0] : undefined);
  const automaticEffort = scope === 'chat' ? selected?.defaultEffort : ['none', 'minimal', 'low'].find(e => selected?.efforts.includes(e)) ?? selected?.defaultEffort;
  const save = async (next: string, nextEffort: string) => {
    setBusy(true); setError('');
    try { await setModelPreference(scope, next, nextEffort, provider); setModel(next); setEffort(nextEffort); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="model-picker">
    <label>{label}<select aria-label={label} value={model} disabled={disabled || busy || !models.length}
      onChange={e => void save(e.target.value, '')}>
      {scope === 'chat' && <option value="">기본 모델{!model && selected ? ` · ${selected.displayName}` : ''}</option>}
      {model && !models.some(m => m.model === model) && <option value={model}>{model} · 목록에 없음</option>}
      {!model && scope === 'translation' && <option value="">모델 선택</option>}
      {models.map(m => <option key={m.model} value={m.model}>{m.displayName}</option>)}
    </select></label>
    {<label>사고 수준 (effort)<select aria-label={`${scope === 'chat' ? '채팅' : '번역'} effort`} value={effort}
      disabled={disabled || busy || !selected?.efforts.length} onChange={e => void save(model, e.target.value)}>
      <option value="">{scope === 'chat' ? '기본값' : '자동 · 속도 우선'}{automaticEffort ? ` · ${automaticEffort}` : ''}</option>
      {effort && !selected?.efforts.includes(effort) && <option value={effort}>{effort} · 재선택 필요</option>}
      {selected?.efforts.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>}
    <button className="model-refresh" disabled={disabled || busy} onClick={() => refresh(n => n + 1)}>{busy ? '모델 확인 중…' : '모델 목록 새로고침'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
