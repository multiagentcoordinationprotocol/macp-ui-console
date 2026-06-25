export function formatDateTime(value?: string | number | Date, timeZone?: string): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(date);
}

export function formatRelativeDuration(ms?: number): string {
  if (!ms || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatNumber(value?: number, options?: Intl.NumberFormatOptions): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', options).format(value);
}

export function formatPercent(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const maybeFraction = value <= 1 ? value : value / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1
  }).format(maybeFraction);
}

export function formatCurrency(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

export function formatChartLabel(label: string, timeZone?: string): string {
  if (ISO_DATE_RE.test(label)) {
    const date = new Date(label);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', timeZone }).format(
        date
      );
    }
  }
  return label;
}

export function getStatusTone(status: string): string {
  if (['completed', 'approved', 'healthy', 'ok', 'accepted'].includes(status)) return 'success';
  if (['running', 'starting', 'binding_session', 'active'].includes(status)) return 'info';
  // `suspended`/`paused` are non-terminal pauses (macp-proto 0.1.3) — warn, don't alarm.
  if (['queued', 'waiting', 'idle', 'suspended', 'paused'].includes(status)) return 'warning';
  if (['failed', 'cancelled', 'expired', 'rejected', 'error'].includes(status)) return 'danger';
  return 'neutral';
}
