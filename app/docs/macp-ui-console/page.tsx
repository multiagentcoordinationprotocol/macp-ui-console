import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listDocs, getCollectionLabel } from '@/lib/docs/loader';

export const metadata = {
  title: 'UI Console docs · MACP Console'
};

export default async function UiConsoleDocsIndexPage() {
  const entries = await listDocs('macp-ui-console');
  const label = getCollectionLabel('macp-ui-console');

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <Link href="/docs" className="docs-back-link">
            <ArrowLeft size={14} />
            Back to docs home
          </Link>
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={24} />
            {label} docs
          </h1>
          <p>
            Reference material for the MACP UI Console itself — architecture, API integration, feature surface, and
            changelog.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All documents</CardTitle>
          <CardDescription>
            {entries.length} document{entries.length === 1 ? '' : 's'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="docs-index-list docs-index-list-spacious">
            {entries.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/docs/macp-ui-console/${entry.slug}`} className="docs-index-item">
                  <span className="docs-index-item-title">{entry.title}</span>
                  {entry.firstParagraph ? <span className="docs-index-item-blurb">{entry.firstParagraph}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
