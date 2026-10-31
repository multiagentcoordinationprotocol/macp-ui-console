Copied verbatim from multiagentcoordinationprotocol at 0756067 (SPEC #217):

- `macp-decision-receipt.schema.json` — `schemas/json/macp-decision-receipt.schema.json`
- `receipt_002_integrity_only.json` — `schemas/conformance/receipt/receipt_002_integrity_only.json`

Copied verbatim from multiagentcoordinationprotocol at 16117c7 (runtime-signed receipts, W5 U1):

- `decision_receipt.json` — `examples/discovery/decision_receipt.json` (the Appendix A example, signed by `example-1`)
- `receipt_keys.json` — `examples/discovery/receipt_keys.json` (the JWK Set holding `example-1`)
- `receipt_004_body_tampered.json` — `schemas/conformance/receipt/receipt_004_body_tampered.json`

Do not hand-edit; re-copy when the spec changes. Used by `lib/utils/receipt.test.ts` and
`components/runs/verification-panel.test.tsx`.
