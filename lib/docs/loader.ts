import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type DocCollection = 'macp-ui-console' | 'macp-playground';

export interface DocEntry {
  slug: string;
  title: string;
  firstParagraph: string;
  sourcePath: string;
}

// Docs are read at build time (generateStaticParams), so these dynamic fs paths are marked
// turbopackIgnore: otherwise Turbopack traces the whole project into the server output.
const REPO_ROOT = process.cwd();

const COLLECTION_DIRS: Record<DocCollection, string> = {
  'macp-ui-console': path.join(REPO_ROOT, 'docs'),
  'macp-playground': path.join(REPO_ROOT, 'docs-content', 'macp-playground')
};

const COLLECTION_LABELS: Record<DocCollection, string> = {
  'macp-ui-console': 'UI Console',
  'macp-playground': 'Examples Service'
};

export function getCollectionLabel(collection: DocCollection): string {
  return COLLECTION_LABELS[collection];
}

function slugify(filename: string): string {
  return filename.replace(/\.md$/i, '');
}

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function extractTitle(content: string, fallbackSlug: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : prettifySlug(fallbackSlug);
}

function extractFirstParagraph(content: string): string {
  const body = content.replace(/^#\s+.+$/m, '').trim();
  const blocks = body.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('```') || trimmed.startsWith('<!--')) continue;
    if (/^[#>|*\-+`]/.test(trimmed)) {
      if (trimmed.startsWith('> ')) {
        return trimmed.replace(/^>\s?/gm, '').trim();
      }
      continue;
    }
    return trimmed.replace(/\s+/g, ' ');
  }
  return '';
}

export async function listDocs(collection: DocCollection): Promise<DocEntry[]> {
  const dir = COLLECTION_DIRS[collection];
  let files: string[];
  try {
    files = await readdir(/*turbopackIgnore: true*/ dir);
  } catch {
    return [];
  }
  const mdFiles = files.filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  const entries = await Promise.all(
    mdFiles.map(async (file) => {
      const slug = slugify(file);
      const full = path.join(/*turbopackIgnore: true*/ dir, file);
      const content = await readFile(/*turbopackIgnore: true*/ full, 'utf8');
      return {
        slug,
        title: extractTitle(content, slug),
        firstParagraph: extractFirstParagraph(content),
        sourcePath: full
      } satisfies DocEntry;
    })
  );
  return entries.sort((a, b) => a.title.localeCompare(b.title));
}

export async function loadDoc(
  collection: DocCollection,
  slug: string
): Promise<{ content: string; title: string; firstParagraph: string } | null> {
  const dir = COLLECTION_DIRS[collection];
  const safe = slug.replace(/[^a-z0-9-_]/gi, '');
  if (!safe) return null;
  const file = path.join(/*turbopackIgnore: true*/ dir, `${safe}.md`);
  try {
    const content = await readFile(/*turbopackIgnore: true*/ file, 'utf8');
    return {
      content,
      title: extractTitle(content, safe),
      firstParagraph: extractFirstParagraph(content)
    };
  } catch {
    return null;
  }
}

export async function loadCollectionReadme(collection: DocCollection): Promise<string | null> {
  const dir = COLLECTION_DIRS[collection];
  const file = path.join(/*turbopackIgnore: true*/ dir, '_readme.md');
  try {
    return await readFile(/*turbopackIgnore: true*/ file, 'utf8');
  } catch {
    return null;
  }
}
