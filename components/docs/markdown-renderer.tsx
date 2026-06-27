'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import GithubSlugger from 'github-slugger';
import type { DocCollection } from '@/lib/docs/loader';
import { MermaidBlock } from './mermaid-block';

interface MarkdownRendererProps {
  content: string;
  collection: DocCollection;
}

const EXTERNAL_REPO_MAP: Record<string, string> = {
  'macp-runtime/docs': 'https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs',
  'macp-control-plane/docs': 'https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs',
  'macp-playground/docs': 'https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs',
  'macp-sdk-python/docs': 'https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs',
  'macp-sdk-typescript/docs': 'https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs'
};

function rewriteHref(raw: string, collection: DocCollection): { href: string; external: boolean } {
  if (!raw) return { href: raw, external: false };
  if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
    return { href: raw, external: false };
  }
  if (/^https?:\/\//i.test(raw)) {
    return { href: raw, external: true };
  }

  // Rewrite relative docs links like ./api-integration.md → /docs/<collection>/api-integration
  const match = raw.match(/^\.?\.?\/?([a-z0-9_-]+)\.md(#.+)?$/i);
  if (match) {
    const slug = match[1];
    const anchor = match[2] ?? '';
    return { href: `/docs/${collection}/${slug}${anchor}`, external: false };
  }

  // Rewrite cross-repo relative links (../../macp-runtime/docs/API.md → github URL)
  for (const [prefix, base] of Object.entries(EXTERNAL_REPO_MAP)) {
    const idx = raw.indexOf(prefix);
    if (idx !== -1) {
      const tail = raw.slice(idx + prefix.length);
      return { href: `${base}${tail}`, external: true };
    }
  }

  return { href: raw, external: false };
}

function makeComponents(collection: DocCollection): Components {
  const slugger = new GithubSlugger();

  function extractText(node: ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
      const nodeWithProps = node as { props?: { children?: ReactNode } };
      return extractText(nodeWithProps.props?.children ?? '');
    }
    return '';
  }

  function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    const Component = (props: { children?: ReactNode }) => {
      const text = extractText(props.children);
      const id = slugger.slug(text);
      const className = `docs-h${level}`;
      const inner = (
        <a href={`#${id}`} className="docs-heading-anchor" aria-label={`Link to ${text}`}>
          {props.children}
        </a>
      );
      switch (level) {
        case 1:
          return (
            <h1 id={id} className={className}>
              {inner}
            </h1>
          );
        case 2:
          return (
            <h2 id={id} className={className}>
              {inner}
            </h2>
          );
        case 3:
          return (
            <h3 id={id} className={className}>
              {inner}
            </h3>
          );
        case 4:
          return (
            <h4 id={id} className={className}>
              {inner}
            </h4>
          );
        case 5:
          return (
            <h5 id={id} className={className}>
              {inner}
            </h5>
          );
        case 6:
          return (
            <h6 id={id} className={className}>
              {inner}
            </h6>
          );
      }
    };
    return Component;
  }

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    a({ href, children }) {
      const resolved = rewriteHref(href ?? '', collection);
      if (resolved.external) {
        return (
          <a href={resolved.href} target="_blank" rel="noopener noreferrer" className="docs-link docs-link-external">
            {children}
          </a>
        );
      }
      if (!resolved.href) return <>{children}</>;
      return (
        <Link href={resolved.href} className="docs-link">
          {children}
        </Link>
      );
    },
    code({ className, children, ...rest }) {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1];
      const text = String(children ?? '').replace(/\n$/, '');
      const inline = !(rest as { node?: unknown }).node || !className;
      if (inline && !lang) {
        return <code className="docs-code-inline">{children}</code>;
      }
      if (lang === 'mermaid') {
        return <MermaidBlock code={text} />;
      }
      return (
        <pre className="code docs-code-block" data-language={lang ?? 'text'}>
          <code>{text}</code>
        </pre>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    table({ children }) {
      return (
        <div className="docs-table-wrap">
          <table className="docs-table">{children}</table>
        </div>
      );
    },
    blockquote({ children }) {
      return <blockquote className="docs-blockquote">{children}</blockquote>;
    },
    hr() {
      return <hr className="docs-hr" />;
    },
    img({ src, alt }) {
      if (!src) return null;
      // Markdown can reference arbitrary remote hosts; next/image requires an explicit allowlist
      // that we can't predict for synced third-party docs. Plain <img> is intentional here.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt={alt ?? ''} className="docs-img" loading="lazy" />;
    }
  };
}

export function MarkdownRenderer({ content, collection }: MarkdownRendererProps) {
  return (
    <article className="docs-article">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents(collection)}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
