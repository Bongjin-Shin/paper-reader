import { useEffect, useRef } from 'react';
import { ChatIcon } from './ChatIcons';
export function ChatQuestion({ text, additional, disabled, editing, draft, onDraft, onEdit, onCancel, onSave }: {
  text: string; additional?: boolean; disabled: boolean; editing: boolean; draft: string;
  onDraft: (value: string) => void; onEdit: () => void; onCancel: () => void; onSave: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.setSelectionRange(draft.length, draft.length); } }, [editing]);
  return <div className="chat-question-row">
    {editing ? <form className="chat-edit-form" onSubmit={e => { e.preventDefault(); if (draft.trim() && draft.trim() !== text.trim() && !disabled) onSave(); }}>
      <textarea ref={input} aria-label={additional ? '추가 질문 수정' : '질문 수정'} value={draft} maxLength={8000} disabled={disabled} onChange={e => onDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); onCancel(); } }} />
      <p>수정한 질문부터 새 답변을 받습니다. 기존 대화는 이전 버전에 보관됩니다.</p>
      <div><button type="button" className="chat-secondary" onClick={onCancel} disabled={disabled}>취소</button><button type="submit" disabled={disabled || !draft.trim() || draft.trim() === text.trim()}>수정 후 전송</button></div>
    </form> : <><p className="chat-question">{additional && <small>추가 질문</small>}{text}</p>
      <button type="button" className="chat-edit-button" aria-label={additional ? '추가 질문 수정' : '질문 수정'} title="질문 수정" disabled={disabled} onClick={onEdit}><ChatIcon name="edit" /></button></>}
  </div>;
}
