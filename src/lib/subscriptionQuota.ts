/** Provider timestamps are Unix seconds; the window duration is not time remaining. */
export function quotaResetTime(resetsAt: number | null) {
  if (resetsAt === null || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const time = resetsAt * 1000;
  return Number.isFinite(new Date(time).getTime()) ? time : null;
}

export function quotaResetText(resetsAt: number | null, now: number) {
  const time = quotaResetTime(resetsAt);
  if (time === null) return '초기화 시각 정보 없음';
  if (time <= now) return '초기화 시각 경과 · 갱신 확인 중';
  const totalHours = Math.floor((time - now) / 3600000);
  if (totalHours === 0) return '1시간 미만 후 초기화';
  const days = Math.floor(totalHours / 24), hours = totalHours % 24;
  const parts = [days ? `${days}일` : '', hours ? `${hours}시간` : ''].filter(Boolean);
  return `${parts.join(' ')} 후 초기화`;
}

export function quotaWindowLabel(minutes: number | null, secondary: boolean) {
  if (minutes === 10080) return '주간';
  if (!minutes || !Number.isFinite(minutes) || minutes < 0) return secondary ? '주간' : '단기';
  return minutes >= 1440 ? `${Number((minutes / 1440).toFixed(1))}일 한도` : minutes >= 60 ? `${Number((minutes / 60).toFixed(1))}시간` : `${minutes}분`;
}
