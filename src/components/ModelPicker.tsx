import { useEffect, useState } from 'react';
import { errorMessage, getChatgptModels, getClaudeModels, getModelPreferences, setModelPreference } from '../lib/backend';
import type { ModelInfo } from '../types';
import { UpwardSelect, type SelectOption } from './UpwardSelect';

export function ModelPicker({ scope, disabled = false, provider = 'chatgpt', compact = false }: { scope: 'translation' | 'chat'; disabled?: boolean; provider?: 'chatgpt' | 'claude'; compact?: boolean }) {
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
  const selectableModels = scope === 'chat' ? models.filter(m => m.model && m.model !== 'default') : models;
  const automaticModel = models.find(m => m.isDefault) ?? models[0];
  const automaticSelection = !model || (scope === 'chat' && model === 'default');
  const selected = selectableModels.find(m => m.model === model)
    ?? (automaticSelection ? selectableModels.find(m => m.model === automaticModel?.model) : undefined);
  const automaticEffort = scope === 'chat' ? selected?.defaultEffort : ['none', 'minimal', 'low'].find(e => selected?.efforts.includes(e)) ?? selected?.defaultEffort;
  // Keep old automatic preferences compatible without showing an automatic choice.
  // If the provider does not identify its default, invite a selection instead of guessing.
  const shownModel = scope === 'chat' && automaticSelection ? selected?.model ?? '' : model;
  const shownEffort = !effort && selected?.efforts.includes(automaticEffort ?? '') ? automaticEffort! : effort;
  const save = async (next: string, nextEffort: string) => {
    setBusy(true); setError('');
    try { await setModelPreference(scope, next, nextEffort, provider); setModel(next); setEffort(nextEffort); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const modelOptions: SelectOption[] = [
    ...(model && !automaticSelection && !selectableModels.some(m => m.model === model) ? [{ value: model, label: `${model} · 목록에 없음` }] : []),
    ...(!model && scope === 'translation' ? [{ value: '', label: '모델 선택' }] : []),
    ...selectableModels.map(m => ({ value: m.model, label: m.displayName })),
  ];
  const effortOptions: SelectOption[] = [
    ...(effort && !selected?.efforts.includes(effort) ? [{ value: effort, label: `${effort} · 재선택 필요` }] : []),
    ...(selected?.efforts.map(value => ({ value, label: value })) ?? []),
  ];
  return <div className={`model-picker${compact ? ' model-picker-compact' : ''}`}>
    <label><span>{label}</span><Picker upward={compact} label={label} placeholder="모델 선택" title={selected?.displayName ?? label} value={shownModel}
      disabled={disabled || busy || !selectableModels.length} options={modelOptions}
      onChange={next => void save(next, scope === 'chat' ? selectableModels.find(m => m.model === next)?.defaultEffort ?? '' : '')} /></label>
    <label><span>사고 수준 (effort)</span><Picker upward={compact} title="사고 수준 (effort)" label={`${scope === 'chat' ? '채팅' : '번역'} effort`} value={shownEffort}
      placeholder={selected && !selected.efforts.length ? '지원 안 함' : 'effort 선택'}
      disabled={disabled || busy || !selected?.efforts.length} options={effortOptions} onChange={next => void save(shownModel || model, next)} /></label>
    <button type="button" className="model-refresh" aria-label="모델 목록 새로고침" title={busy ? '모델 확인 중…' : '모델 목록 새로고침'} disabled={disabled || busy} onClick={() => refresh(n => n + 1)}>{compact ? '↻' : busy ? '모델 확인 중…' : '모델 목록 새로고침'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function Picker({ upward, ...props }: Parameters<typeof UpwardSelect>[0] & { upward: boolean }) {
  if (upward) return <UpwardSelect {...props} />;
  return <select aria-label={props.label} title={props.title} value={props.value} disabled={props.disabled}
    onChange={event => props.onChange(event.target.value)}>
    {!props.options.some(option => option.value === props.value) && <option value="" disabled>{props.placeholder}</option>}
    {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}
