import Link from 'next/link';
import { ArrowLeft, FolderOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listDocs, getCollectionLabel } from '@/lib/docs/loader';

export const metadata = {
  title: 'Examples Service docs · MACP Console'
};

export default async function ExamplesServiceDocsIndexPage() {
  const entries = await listDocs('macp-playground');
  const label = getCollectionLabel('macp-playground');

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <Link href="/docs" className="docs-back-link">
            <ArrowLeft size={14} />
            Back to docs home
          </Link>
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <FolderOpen size={24} />
            {label} docs
          </h1>
          <p>
            Synced from the <code>macp-playground</code> repo. Covers scenario authoring, launch compilation, agent
            hosting, and the worker bootstrap contract.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All documents</CardTitle>
          <CardDescription>
            {entries.length === 0
              ? 'No docs synced yet — the sync workflow will populate this list on the next push to the source repo.'
              : `${entries.length} document${entries.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="panel">
              <p className="muted">
                This collection is syncd from{' '}
                <a
                  href="https://github.com/multiagentcoordinationprotocol/macp-playground/tree/main/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="docs-link docs-link-external"
                >
                  multiagentcoordinationprotocol/macp-playground
                </a>
                . Trigger the sync workflow in this repo to pull the current markdown, or push to the upstream
                repo&apos;s <code>main</code> branch.
              </p>
            </div>
          ) : (
            <ul className="docs-index-list docs-index-list-spacious">
              {entries.map((entry) => (
                <li key={entry.slug}>
                  <Link href={`/docs/macp-playground/${entry.slug}`} className="docs-index-item">
                    <span className="docs-index-item-title">{entry.title}</span>
                    {entry.firstParagraph ? (
                      <span className="docs-index-item-blurb">{entry.firstParagraph}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
