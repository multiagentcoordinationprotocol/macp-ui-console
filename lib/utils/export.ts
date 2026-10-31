import type { RunRecord, CanonicalEvent, RunStateProjection, Artifact } from '@/lib/types';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvField(String(row[header] ?? ''))).join(','))
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

export function exportToJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

/** Saves `text` byte-for-byte (no re-serialization), e.g. a signed receipt whose bytes must not change. */
export function exportRawJson(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: 'application/json' }), filename);
}

export function flattenRunForCsv(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? '',
    endedAt: run.endedAt ?? '',
    scenarioRef: run.metadata?.scenarioRef ?? run.source?.ref ?? '',
    environment: run.metadata?.environment ?? '',
    templateId: run.metadata?.templateId ?? '',
    totalTokens: run.metadata?.totalTokens ?? '',
    estimatedCostUsd: run.metadata?.estimatedCostUsd ?? '',
    durationMs: run.metadata?.durationMs ?? '',
    tags: Array.isArray(run.metadata?.tags) ? run.metadata.tags.join(';') : ''
  };
}

export function exportToJsonl(items: unknown[], filename: string) {
  const lines = items.map((item) => JSON.stringify(item)).join('\n');
  const blob = new Blob([lines], { type: 'application/x-ndjson' });
  downloadBlob(blob, filename);
}

export function exportTraceBundle(
  runId: string,
  events: CanonicalEvent[],
  state: RunStateProjection | undefined,
  artifacts: Artifact[],
  filename: string
) {
  exportToJson({ runId, state, canonicalEvents: events, artifacts, exportedAt: new Date().toISOString() }, filename);
}
