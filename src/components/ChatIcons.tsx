export function ChatIcon({ name }: { name: 'send' | 'stop' | 'edit' | 'refresh' | 'previous' | 'next' }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'send' && <path d="M12 19V5m-6 6 6-6 6 6" />}
    {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />}
    {name === 'edit' && <><path d="m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14Z" /><path d="M13 20h7" /></>}
    {name === 'refresh' && <><path d="M20 11a8 8 0 1 0-2 6M20 4v6h-6" /></>}
    {name === 'previous' && <path d="m14 6-6 6 6 6" />}
    {name === 'next' && <path d="m10 6 6 6-6 6" />}
  </svg>;
}
