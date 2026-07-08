'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

/**
 * Breadcrumbs — R5.3.
 *
 * Derives a trail from the current route. Segment-to-label mapping is
 * intentionally simple (title-case, dash → space); specific routes
 * with dynamic IDs get a short prefix + `…` truncated id instead of
 * the raw uuid.
 *
 * Examples:
 *   /runs/[runId]                       → Runs › <id:8>
 *   /runs/[runId]/compare/[rightId]     → Runs › <id:8> › Compare › <id:8>
 *   /runs/[runId]/nodes/[nodeId]        → Runs › <id:8> › Nodes › <nodeId>
 *   /scenarios/[pack]/[scenario]        → Scenarios › <pack> › <scenario>
 *   /policies/[policyId]                → Policies › <policyId>
 *   /                                   → (nothing — breadcrumb hidden on root)
 *
 * Rendered under the v2 topbar by the AppShell. Legacy design doesn't
 * render it (the topbar has no breadcrumb slot in v1).
 */

interface Crumb {
  label: string;
  href?: string;
}

const KNOWN_SECTION_LABELS: Record<string, string> = {
  runs: 'Runs',
  scenarios: 'Scenarios',
  agents: 'Agents',
  logs: 'Logs',
  traces: 'Traces',
  observability: 'Observability',
  settings: 'Settings',
  policies: 'Policies',
  modes: 'Modes',
  compare: 'Compare',
  nodes: 'Node',
  live: 'Live',
  new: 'New'
};

function prettify(segment: string): string {
  return KNOWN_SECTION_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function looksLikeId(segment: string): boolean {
  // Treat as an opaque id (truncate rather than title-case) when it's either:
  //  - UUID-ish / ≥16 chars of hex, or
  //  - a 22+-char base64url token (runtime session IDs are 36-char base64url,
  //    which can contain `A-Z`, `g-z`, `_`, and `-`). `runId === sessionId` for
  //    discovered sessions, so such IDs can appear as route segments.
  return /^[0-9a-f-]{16,}$/i.test(segment) || /^[A-Za-z0-9_-]{22,}$/.test(segment);
}

function buildCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [];

  const crumbs: Crumb[] = [];
  let href = '';
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    href += `/${segment}`;
    const label = looksLikeId(segment) ? `${segment.slice(0, 8)}…` : prettify(segment);
    // Last crumb has no href (it's the current page).
    crumbs.push(i === parts.length - 1 ? { label } : { label, href });
  }
  return crumbs;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname ?? ''), [pathname]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {crumbs.map((crumb, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {i > 0 ? <span className="breadcrumb-sep">›</span> : null}
          {crumb.href ? (
            <Link href={crumb.href}>{crumb.label}</Link>
          ) : (
            <span className="breadcrumb-current">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
