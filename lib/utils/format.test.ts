import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatRelativeDuration,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatChartLabel,
  titleCase,
  truncate,
  getStatusTone
} from './format';

describe('formatDateTime', () => {
  it('returns em-dash for undefined', () => {
    expect(formatDateTime()).toBe('—');
  });

  it('returns em-dash for invalid date string', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('formats a valid ISO string', () => {
    const result = formatDateTime('2025-01-15T10:30:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });

  it('formats a Date object', () => {
    const result = formatDateTime(new Date('2025-06-01T12:00:00Z'));
    expect(result).toContain('Jun');
    expect(result).toContain('2025');
  });

  it('formats a numeric timestamp', () => {
    const result = formatDateTime(1700000000000);
    expect(result).toContain('2023');
  });

  it('formats with explicit UTC timezone', () => {
    const result = formatDateTime('2025-07-20T14:30:00Z', 'UTC');
    expect(result).toContain('Jul');
    expect(result).toContain('20');
    expect(result).toContain('2025');
    expect(result).toContain('2:30');
    expect(result).toContain('PM');
  });
});

describe('formatRelativeDuration', () => {
  it('returns em-dash for undefined', () => {
    expect(formatRelativeDuration()).toBe('—');
  });

  it('returns em-dash for negative ms', () => {
    expect(formatRelativeDuration(-100)).toBe('—');
  });

  it('returns em-dash for zero', () => {
    expect(formatRelativeDuration(0)).toBe('—');
  });

  it('returns seconds for < 60s', () => {
    expect(formatRelativeDuration(5000)).toBe('5s');
    expect(formatRelativeDuration(59000)).toBe('59s');
  });

  it('returns minutes and seconds for < 60m', () => {
    expect(formatRelativeDuration(90000)).toBe('1m 30s');
    expect(formatRelativeDuration(3599000)).toBe('59m 59s');
  });

  it('returns hours and minutes for >= 60m', () => {
    expect(formatRelativeDuration(3600000)).toBe('1h 0m');
    expect(formatRelativeDuration(7200000 + 1800000)).toBe('2h 30m');
  });
});

describe('formatNumber', () => {
  it('returns em-dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('returns em-dash for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('formats a whole number', () => {
    expect(formatNumber(1234)).toBe('1,234');
  });

  it('passes NumberFormat options through', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1,234.50');
  });
});

describe('formatPercent', () => {
  it('returns em-dash for undefined', () => {
    expect(formatPercent(undefined)).toBe('—');
  });

  it('treats values <= 1 as fractions', () => {
    expect(formatPercent(0.95)).toBe('95%');
  });

  it('treats values > 1 as percentages (divides by 100)', () => {
    expect(formatPercent(95)).toBe('95%');
  });
});

describe('formatCurrency', () => {
  it('returns em-dash for undefined', () => {
    expect(formatCurrency(undefined)).toBe('—');
  });

  it('formats USD with 2 decimal places', () => {
    const result = formatCurrency(12.5);
    expect(result).toContain('12.50');
  });
});

describe('titleCase', () => {
  it('converts snake_case', () => {
    expect(titleCase('hello_world')).toBe('Hello World');
  });

  it('converts kebab-case', () => {
    expect(titleCase('hello-world')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(titleCase('')).toBe('');
  });

  it('handles single word', () => {
    expect(titleCase('hello')).toBe('Hello');
  });
});

describe('truncate', () => {
  it('returns string unchanged if under max', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('truncates and adds ellipsis at max', () => {
    expect(truncate('hello world', 6)).toBe('hello…');
  });

  it('uses default max of 120', () => {
    const longStr = 'a'.repeat(200);
    const result = truncate(longStr);
    expect(result.length).toBe(120);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('formatChartLabel', () => {
  it('formats ISO timestamp to short date string', () => {
    const result = formatChartLabel('2026-04-01T10:00:00Z');
    expect(result).toContain('Apr');
    expect(result).toContain('1');
  });

  it('returns plain string labels unchanged', () => {
    expect(formatChartLabel('Mon')).toBe('Mon');
    expect(formatChartLabel('timeout')).toBe('timeout');
    expect(formatChartLabel('Week 1')).toBe('Week 1');
  });

  it('returns non-ISO date-like strings unchanged', () => {
    expect(formatChartLabel('April 1')).toBe('April 1');
    expect(formatChartLabel('2026')).toBe('2026');
  });

  it('handles ISO timestamps with different hours', () => {
    const morning = formatChartLabel('2026-06-15T08:00:00Z');
    expect(morning).toContain('Jun');
    expect(morning).toContain('15');

    const evening = formatChartLabel('2026-12-25T23:30:00Z');
    expect(evening).toContain('Dec');
    expect(evening).toContain('25');
  });

  it('formats with explicit UTC timezone', () => {
    const result = formatChartLabel('2026-03-10T16:00:00Z', 'UTC');
    expect(result).toContain('Mar');
    expect(result).toContain('10');
    expect(result).toContain('4');
  });
});

describe('getStatusTone', () => {
  it('maps completed to success', () => {
    expect(getStatusTone('completed')).toBe('success');
  });

  it('maps running to info', () => {
    expect(getStatusTone('running')).toBe('info');
  });

  it('maps queued to warning', () => {
    expect(getStatusTone('queued')).toBe('warning');
  });

  it('maps failed to danger', () => {
    expect(getStatusTone('failed')).toBe('danger');
  });

  it('maps cancelled to danger', () => {
    expect(getStatusTone('cancelled')).toBe('danger');
  });

  it('maps expired to danger', () => {
    expect(getStatusTone('expired')).toBe('danger');
  });

  it('maps suspended (non-terminal pause) to warning', () => {
    expect(getStatusTone('suspended')).toBe('warning');
  });

  it('maps unknown status to neutral', () => {
    expect(getStatusTone('something-else')).toBe('neutral');
  });
});
