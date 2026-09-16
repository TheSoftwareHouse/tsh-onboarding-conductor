import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

// The exchange from the README's "Your first onboarding", verbatim from a real run.
const TERMINAL: { kind: 'command' | 'output'; text: string }[] = [
  {
    kind: 'command',
    text: `curl -X POST localhost:3000/v1/onboardings \\\n    -H 'Content-Type: application/json' -d '{"workflowId":"base"}'`,
  },
  {
    kind: 'output',
    text: `{"onboardingId":"01a023ea-bf9e-772d-9f5a-f49b33b3dd1a","status":"awaiting_user",\n "currentStep":"collect_email","expiresAt":null}`,
  },
  { kind: 'command', text: `curl localhost:3000/v1/onboardings/01a023ea-.../state` },
  {
    kind: 'output',
    text: `… "step": { "name": "collect_email", "canSubmit": true, "fields": [\n     { "name": "email", "type": "text", "required": true, "value": null,\n       "schema": { "type": "string", "format": "email" } } ] }`,
  },
  {
    kind: 'command',
    text: `curl -X POST localhost:3000/v1/onboardings/01a023ea-.../submit \\\n    -H 'Content-Type: application/json' -d '{"email":"person@example.com"}'`,
  },
  {
    kind: 'output',
    text: `{"appliedStep":"collect_email","status":"awaiting_user",\n "currentStep":"accept_terms","rejectionReason":null}`,
  },
];

const ENTRIES = [
  {
    index: '01',
    eyebrow: 'Guides',
    title: 'Run it, then run your first onboarding',
    body: 'From a clean machine to a working stack in five commands, then the three calls every onboarding is made of.',
    to: '/guides/',
    label: 'Start here',
  },
  {
    index: '02',
    eyebrow: 'API reference',
    title: 'Every route, with the errors it can return',
    body: 'Generated from the engine itself: request and response shapes, the exact error codes per route, and the OpenAPI document to download.',
    to: '/api',
    label: 'Open the reference',
  },
  {
    index: '03',
    eyebrow: 'Fixtures',
    title: 'Thirteen workflows to copy from',
    body: 'Every example and built-in workflow the engine ships with, each with its step map and the JSON file itself.',
    to: '/fixtures',
    label: 'Browse the gallery',
  },
];

function highlightJson(text: string): ReactNode[] {
  // Keys blue, strings yellow, literals purple, everything else plain: the dark syntax palette.
  const pattern = /("[^"]*")(\s*:)?|\b(true|false|null|\d+)\b/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <span key={match.index} className={match[2] ? styles.key : styles.string}>
          {match[1]}
        </span>,
        match[2] ?? '',
      );
    } else {
      nodes.push(
        <span key={match.index} className={styles.literal}>
          {match[3]}
        </span>,
      );
    }
    last = pattern.lastIndex;
  }
  nodes.push(text.slice(last));

  return nodes;
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const gradient = useBaseUrl('/img/kv-gradient.jpg');

  return (
    <Layout title="Onboarding Conductor documentation" description={siteConfig.tagline}>
      <main>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className="tsh-caps">Onboarding Conductor · Documentation</p>
            <h1 className={styles.headline}>{siteConfig.tagline}</h1>
            <p className={styles.lead}>
              → Describe an onboarding as a list of steps: what each step asks for, which providers
              it calls and where each outcome leads. The engine runs it, keeps every customer's
              place, retries what needs it and records what happened.
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary" to="/guides/getting-started">
                Get started
              </Link>
              <Link className="button button--secondary" to="/api">
                API reference
              </Link>
            </div>
          </div>
          <div
            className={styles.terminal}
            aria-label="An onboarding started, read and advanced with three requests"
          >
            <div className={styles.terminalBar}>
              <span>shell</span>
              <span>base workflow</span>
            </div>
            <pre className={styles.terminalBody}>
              {TERMINAL.map((line, index) =>
                line.kind === 'command' ? (
                  <span key={index} className={styles.command}>
                    <span className={styles.prompt}>$ </span>
                    {line.text}
                    {'\n'}
                  </span>
                ) : (
                  <span key={index} className={styles.output}>
                    {highlightJson(line.text)}
                    {'\n\n'}
                  </span>
                ),
              )}
            </pre>
          </div>
        </section>

        <section className={styles.entries}>
          {ENTRIES.map((entry) => (
            <Link key={entry.index} to={entry.to} className={styles.entry}>
              <span className="tsh-caps">
                {entry.index} · {entry.eyebrow}
              </span>
              <span className={styles.entryTitle}>{entry.title}</span>
              <span className={styles.entryBody}>{entry.body}</span>
              <span className={styles.entryLink}>{entry.label} →</span>
            </Link>
          ))}
        </section>

        <section className={styles.statement} style={{ backgroundImage: `url(${gradient})` }}>
          <div className={styles.statementInner}>
            <h2 className={styles.statementHeadline}>
              One kind of step. Checked when the service starts. Never changed underneath a
              customer.
            </h2>
            <ul className={clsx(styles.statementList)}>
              <li>
                → Manual review, waiting on a slow provider and finishing are the same shape with
                different content.
              </li>
              <li>
                → Workflows, connector settings and configuration are validated at boot, so a
                mistake stops the start rather than someone's onboarding.
              </li>
              <li>
                → A workflow in flight keeps its shape; publishing a new revision leaves existing
                customers on the one they started.
              </li>
            </ul>
          </div>
        </section>
      </main>
    </Layout>
  );
}
