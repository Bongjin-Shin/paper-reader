import { useRef, useState } from 'react';
import { errorMessage } from '../lib/backend';

export function PaperMemo({ title, memo, disabled, onSave }: {
  title: string; memo: string; disabled: boolean; onSave: (memo: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(memo);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const composing = useRef(false);
  const cancel = () => { setEditing(false); setError(''); };
  return <div className="library-memo" onContextMenu={event => event.stopPropagation()}>
    {editing ? <form aria-label={`${title} 메모 편집`} onSubmit={event => {
      event.preventDefault();
      if (disabled || saving) return;
      if (draft === memo) { cancel(); return; }
      setSaving(true); setError('');
      void onSave(draft).then(() => setEditing(false)).catch(error => setError(errorMessage(error)))
        .finally(() => setSaving(false));
    }} onKeyDown={event => {
      // Escape belongs to the IME while composing, not to the memo editor.
      if (event.key === 'Escape' && !saving && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.stopPropagation(); cancel();
      }
    }}>
      <textarea autoFocus aria-label={`${title} 메모`} rows={4} maxLength={10000} value={draft}
        disabled={disabled || saving} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; setDraft(event.currentTarget.value); }}
        onBlur={() => { composing.current = false; }} />
      {error && <p className="bubble-error" role="alert">{error}</p>}
      <div className="library-memo-actions"><button type="submit" disabled={disabled || saving}>{saving ? '저장 중…' : '저장'}</button>
        <button type="button" disabled={saving} onClick={cancel}>취소</button></div>
    </form> : <button className={`library-memo-content ${memo ? '' : 'empty'}`} disabled={disabled} aria-label={`${title} 메모 편집`}
      onClick={() => { setDraft(memo); setError(''); setEditing(true); }}>{memo || '메모 추가'}</button>}
  </div>;
}
