'use client';

import { useEffect, useRef, useState } from 'react';

interface MermaidBlockProps {
  code: string;
}

function readTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'dark';
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? 'default' : 'dark';
}

let idCounter = 0;

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const diagramId = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mod = await import('mermaid');
        if (cancelled) return;
        const mermaid = mod.default;
        const theme = readTheme();
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: 'strict',
          // Mermaid 12 defaults to ELK layout and the neo look; pin the 11.x appearance
          layout: 'dagre',
          look: 'classic',
          fontFamily: 'var(--font-dm-sans), Inter, sans-serif'
        });
        const { svg } = await mermaid.render(diagramId.current, code);
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setRendered(true);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    }

    render();

    const observer = new MutationObserver(() => {
      void render();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [code]);

  if (error) {
    return (
      <div className="docs-mermaid docs-mermaid-error">
        <p className="docs-mermaid-error-label">Diagram failed to render</p>
        <pre className="code">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="docs-mermaid" aria-busy={!rendered}>
      <div ref={containerRef} />
      {!rendered && (
        <pre className="code docs-mermaid-fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
