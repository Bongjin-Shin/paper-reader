import type { TextZoom } from '../lib/useTextZoom';

export function TextZoomControls({ zoom, label }: { zoom: TextZoom; label: string }) {
  return <div className="text-zoom-controls" role="group" aria-label={`${label} 글자 크기`}>
    <span className="text-zoom-label">{label}</span>
    <button type="button" aria-label={`${label} 축소`} title="글자 축소 (Ctrl+휠 아래)" disabled={zoom.scale <= .7} onClick={() => zoom.step(-1)}>−</button>
    <button type="button" className="text-zoom-reset" aria-label={`${label} 글자 크기 초기화`} title="기본 크기로 (Ctrl+0)" onClick={zoom.reset}>{Math.round(zoom.scale * 100)}%</button>
    <button type="button" aria-label={`${label} 확대`} title="글자 확대 (Ctrl+휠 위)" disabled={zoom.scale >= 2} onClick={() => zoom.step(1)}>+</button>
  </div>;
}
