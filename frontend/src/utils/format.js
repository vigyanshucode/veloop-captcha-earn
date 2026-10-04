const formatGems = (n) => {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, '') || '0';
};

const formatDateTime = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const timeRemaining = (expiresAt) => {
  if (!expiresAt) return { seconds: 0, expired: true, label: '—' };
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return { seconds: 0, expired: true, label: '—' };
  const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const expired = diff <= 0;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return { seconds: diff, expired, label: `${mm}:${ss}` };
};

export { formatGems, formatDateTime, timeRemaining };
