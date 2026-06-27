export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 560 460"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby="arch-title arch-desc"
      className="docs-diagram"
    >
      <title id="arch-title">UI Console architecture</title>
      <desc id="arch-desc">
        The browser calls a Next.js route-handler proxy that forwards to the Examples Service and Control Plane. The
        Control Plane observes the Runtime read-only; agents authenticate to the Runtime directly via the SDK.
      </desc>

      <defs>
        <linearGradient id="arch-node" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--panel)" />
          <stop offset="100%" stopColor="var(--panel-2)" />
        </linearGradient>
        <linearGradient id="arch-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--brand-2)" stopOpacity="0.14" />
        </linearGradient>
        <marker id="arch-tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted)" />
        </marker>
        <marker id="arch-tip-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--brand-2)" />
        </marker>
      </defs>

      {/* Browser */}
      <g>
        <rect
          x="210"
          y="20"
          width="140"
          height="52"
          rx="14"
          fill="url(#arch-accent)"
          stroke="var(--brand)"
          strokeOpacity="0.5"
        />
        <text x="280" y="44" textAnchor="middle" className="docs-diagram-title">
          Browser
        </text>
        <text x="280" y="60" textAnchor="middle" className="docs-diagram-subtitle">
          React 19 UI
        </text>
      </g>

      {/* edge */}
      <line
        x1="280"
        y1="72"
        x2="280"
        y2="110"
        stroke="var(--muted)"
        strokeOpacity="0.6"
        strokeWidth="1"
        markerEnd="url(#arch-tip)"
      />

      {/* Proxy */}
      <g>
        <rect x="130" y="110" width="300" height="56" rx="14" fill="url(#arch-node)" stroke="var(--border)" />
        <text x="280" y="134" textAnchor="middle" className="docs-diagram-title">
          Next.js Route-Handler Proxy
        </text>
        <text x="280" y="152" textAnchor="middle" className="docs-diagram-mono">
          /api/proxy/{'{'}example,macp-control-plane{'}'}
        </text>
      </g>

      {/* split edges */}
      <path
        d="M 210 166 Q 160 190 130 210"
        fill="none"
        stroke="var(--muted)"
        strokeOpacity="0.6"
        strokeWidth="1"
        markerEnd="url(#arch-tip)"
      />
      <path
        d="M 350 166 Q 400 190 430 210"
        fill="none"
        stroke="var(--muted)"
        strokeOpacity="0.6"
        strokeWidth="1"
        markerEnd="url(#arch-tip)"
      />

      {/* Examples Service */}
      <g>
        <rect x="30" y="210" width="200" height="66" rx="14" fill="url(#arch-node)" stroke="var(--border)" />
        <circle cx="48" cy="232" r="4" fill="var(--brand)" />
        <text x="62" y="236" className="docs-diagram-title">
          Examples Service
        </text>
        <text x="48" y="256" className="docs-diagram-subtitle">
          catalog · schema · compile
        </text>
        <text x="48" y="270" className="docs-diagram-mono">
          :3000
        </text>
      </g>

      {/* Control Plane */}
      <g>
        <rect x="330" y="210" width="200" height="66" rx="14" fill="url(#arch-node)" stroke="var(--border)" />
        <circle cx="348" cy="232" r="4" fill="var(--brand)" />
        <text x="362" y="236" className="docs-diagram-title">
          Control Plane
        </text>
        <text x="348" y="256" className="docs-diagram-subtitle">
          observer · state · SSE
        </text>
        <text x="348" y="270" className="docs-diagram-mono">
          :3001
        </text>
      </g>

      {/* CP → Runtime edge */}
      <path
        d="M 430 276 Q 430 320 380 340"
        fill="none"
        stroke="var(--muted)"
        strokeOpacity="0.6"
        strokeWidth="1"
        markerEnd="url(#arch-tip)"
      />
      <text x="435" y="310" className="docs-diagram-label">
        gRPC observer
      </text>

      {/* Runtime */}
      <g>
        <rect
          x="210"
          y="340"
          width="140"
          height="60"
          rx="14"
          fill="url(#arch-node)"
          stroke="var(--brand-2)"
          strokeOpacity="0.55"
        />
        <circle cx="228" cy="362" r="4" fill="var(--brand-2)" />
        <text x="242" y="366" className="docs-diagram-title">
          Runtime
        </text>
        <text x="228" y="386" className="docs-diagram-subtitle">
          Rust · gRPC
        </text>
      </g>

      {/* Agents */}
      <g>
        <rect
          x="30"
          y="340"
          width="140"
          height="60"
          rx="14"
          fill="url(#arch-node)"
          stroke="var(--brand-2)"
          strokeOpacity="0.45"
          strokeDasharray="4 3"
        />
        <circle cx="48" cy="362" r="4" fill="var(--brand-2)" />
        <text x="62" y="366" className="docs-diagram-title">
          Agents
        </text>
        <text x="48" y="386" className="docs-diagram-subtitle">
          macp-sdk
        </text>
      </g>

      {/* agents → runtime dashed */}
      <line
        x1="170"
        y1="370"
        x2="210"
        y2="370"
        stroke="var(--brand-2)"
        strokeOpacity="0.7"
        strokeWidth="1.2"
        strokeDasharray="4 3"
        markerEnd="url(#arch-tip-accent)"
      />
      <text x="190" y="360" textAnchor="middle" className="docs-diagram-label docs-diagram-label-accent">
        direct-agent-auth
      </text>

      {/* caption */}
      <text x="280" y="430" textAnchor="middle" className="docs-diagram-caption">
        Browser talks only to the proxy. Agents talk only to the runtime. CP never calls Send.
      </text>
    </svg>
  );
}
