/**
 * `/showcase` — the stable "run a session in your browser" deep link (W1.7). The spec quickstart
 * links here, so the URL and the scenario it launches are a public contract: change them together.
 *
 * The template is the playground's `showcase` template on the fraud Decision-mode scenario. It sets
 * `launch.agentExecution: deterministic`, which makes the playground strip every LLM provider key
 * from the agent processes it spawns — so the run is deterministic and needs no key whatever the
 * hosted deployment is configured with, and it finishes in seconds.
 */
export const SHOWCASE_SCENARIO_REF = 'fraud/high-value-new-device@1.0.0';
export const SHOWCASE_TEMPLATE_ID = 'showcase';
