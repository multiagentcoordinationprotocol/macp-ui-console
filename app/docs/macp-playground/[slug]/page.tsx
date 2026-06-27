import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { MarkdownRenderer } from '@/components/docs/markdown-renderer';
import { listDocs, loadDoc } from '@/lib/docs/loader';

export async function generateStaticParams() {
  const entries = await listDocs('macp-playground');
  return entries.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await loadDoc('macp-playground', slug);
  if (!doc) return { title: 'Not found · MACP Console' };
  return {
    title: `${doc.title} · MACP Console`,
    description: doc.firstParagraph?.slice(0, 180)
  };
}

export default async function ExamplesServiceDocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await loadDoc('macp-playground', slug);
  if (!doc) notFound();

  return (
    <div className="stack docs-doc-page">
      <div className="docs-doc-breadcrumbs">
        <Link href="/docs" className="docs-back-link">
          <ArrowLeft size={14} />
          Docs home
        </Link>
        <span aria-hidden>·</span>
        <Link href="/docs/macp-playground" className="docs-back-link">
          Examples Service
        </Link>
      </div>
      <MarkdownRenderer content={doc.content} collection="macp-playground" />
    </div>
  );
}
