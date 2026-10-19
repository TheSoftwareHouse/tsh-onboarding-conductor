#!/usr/bin/env node
// Writes the fixture pages and the manifest the gallery and the sidebar read. Every workflow file in
// workflows/fixtures and workflows/built-in gets a page of its own; a built-in page also names the
// revision written in the other form.
// The workflow files are the source; nothing written here is committed, and `pnpm build` runs this
// first. Every document is compiled the way the engine compiles it, so the step map shows what
// actually runs.
//
// Usage: node scripts/generate-fixtures.mjs [--clean]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..', '..');
const outputDir = resolve(here, '..', 'docs', 'fixtures');
const manifestFile = join(outputDir, 'fixtures.manifest.json');

const SCOPES = [
  { scope: 'fixtures', label: 'Example workflow', directory: 'workflows/fixtures' },
  { scope: 'built-in', label: 'Built-in workflow', directory: 'workflows/built-in' },
];

/** One sentence per workflow, verified against the file it describes. Falls back to the derived summary. */
const DESCRIPTIONS = {
  base: 'The smallest complete flow: collect an email, have the terms accepted, approve. Two stand-in KYC connectors show where a provider call sits.',
  'conditional-fields-and-transitions':
    'Fields that appear only when an earlier answer makes them relevant, transitions guarded by conditions, and a manual review fork.',
  'file-upload':
    'One document upload field, exercising the reserve-then-complete flow against object storage.',
  'lean-ksa':
    'A Saudi IBAN checked against the applicant’s national ID through Lean, then a bank linked through Lean’s widget, with income insights arriving on a signed webhook and deciding between approval and manual review.',
  'manual-review':
    'A step that parks the onboarding for an operator, with approve, reject and invalid each leading somewhere.',
  scoring:
    'Named scores accumulated by rules across phone verification, an identity check and a manual review, with transitions that branch on them.',
  'credit-check':
    'A UK BNPL credit check on the mock_credit provider: consent, one bank-data upload, a score banded into approved, review or declined, and a retry path. Runs with no network.',
  'sendgrid-email': 'Sending an email through SendGrid.',
  'twilio-verify': 'A one-time code sent and checked through Twilio Verify.',
  'eu-b2c-individual-kyc-eea':
    'The production reference flow written as custom steps: EU B2C individual KYC across the EEA, where the applicant chooses between a passport and a national ID card.',
  'eu-b2c-individual-kyc-eea-v2':
    'The same flow written with specialized step types, which compiles to the steps of revision 1 when it loads.',
  'eu-b2c-individual-kyc-eea-veriff':
    'The production reference flow with Veriff as the identity provider — identical to eu-b2c-individual-kyc-eea except that the KYC step binds veriff_kyc — written as custom steps.',
  'uk-bnpl-credit-check-algoan':
    'A UK buy-now-pay-later credit check: the applicant consents, one open-banking document is scored by Algoan, and the score decides approved, manual review or declined, with a retry path for a failed analysis.',
  'eu-b2c-individual-kyc-eea-veriff-v2':
    'The Veriff flow written with specialized step types, which compiles to the steps of its revision 1 when it loads.',
};

function loadDdl() {
  try {
    return createRequire(import.meta.url)('@tsh/ddl-schema');
  } catch (error) {
    process.stderr.write(
      'Cannot load @tsh/ddl-schema: build it first with `pnpm --filter @tsh/ddl-schema build`' +
        ' (`pnpm docs:dev` and `pnpm docs:build` do this for you).\n',
    );
    throw error;
  }
}

function clean() {
  if (!existsSync(outputDir)) {
    return;
  }

  for (const entry of readdirSync(outputDir)) {
    if ((entry.endsWith('.mdx') && entry !== 'index.mdx') || entry === 'fixtures.manifest.json') {
      rmSync(join(outputDir, entry));
    }
  }
}

const code = (value) => `\`${String(value).replace(/`/g, "'")}\``;
const list = (values) => (values.length ? values.map(code).join(', ') : '—');
const unique = (values) => [...new Set(values)];

function describeFeatures(definition) {
  const features = [];
  const steps = definition.steps;
  const fields = steps.flatMap((step) => Object.values(step.data ?? {}));
  const transitions = steps.flatMap((step) => step.transitions ?? []);
  const connectors = steps.flatMap((step) => step.connectors ?? []);

  if (fields.some((field) => field.when)) features.push('conditional fields');
  if (transitions.some((transition) => transition.when)) features.push('conditional transitions');
  if (transitions.some((transition) => String(transition.status).startsWith('manual.')))
    features.push('manual review');
  if (fields.some((field) => field.type === 'file')) features.push('document upload');
  if (connectors.some((connector) => connector.async))
    features.push('asynchronous provider callback');
  if (connectors.some((connector) => connector.fallback?.length))
    features.push('connector fallback chain');
  if (connectors.some((connector) => connector.retry)) features.push('connector retries');
  if (steps.some((step) => step.scoring?.length) || definition.scoring) features.push('scoring');
  if (definition.webhook) features.push('client webhook');

  return features;
}

function summarize(definition, connectorTypes, features) {
  const parts = [
    `${definition.steps.length} steps starting at ${code(definition.initial ?? definition.steps[0]?.name)}`,
  ];
  parts.push(connectorTypes.length ? `connectors: ${connectorTypes.join(', ')}` : 'no connectors');
  if (features.length) parts.push(`shows ${features.join(', ')}`);

  return parts.join('; ') + '.';
}

function stepRow(step) {
  const collects = Object.entries(step.data ?? {}).map(
    ([name, field]) => `${code(name)} (${field.type}${field.when ? ', conditional' : ''})`,
  );
  const connectors = (step.connectors ?? []).map(
    (connector) => `${code(connector.id)}${connector.async ? ' (async)' : ''}`,
  );
  const transitions = (step.transitions ?? []).map((transition) => {
    const target = transition.target === undefined ? 'stays' : code(transition.target);
    const guard = transition.when ? ' when …' : '';
    const reason = transition.reason ? ` [${transition.reason.join(', ')}]` : '';
    return `${code(transition.status)}${reason}${guard} → ${target}`;
  });

  return `| ${code(step.name)} | ${code(step.status)} | ${collects.join('<br />') || '—'} | ${connectors.join('<br />') || '—'} | ${transitions.join('<br />') || 'terminal'} |`;
}

const STEP_MAP_HEADER = [
  '| Step | Status | Collects | Connectors | Transitions |',
  '| --- | --- | --- | --- | --- |',
];

function stepRows(definition) {
  return definition.steps.map(stepRow);
}

function authoredStepRows(steps) {
  return steps.map((step) => {
    const ports = step.ports.map(
      (port) =>
        `${code(port.name)} → ${port.arms.map((arm) => `${code(arm.target)}${arm.when ? ' when …' : ''}`).join(' / ')}`,
    );
    return `| ${code(step.name)} | ${code(step.type)} | ${step.category} | ${list(step.compiledStepNames)} | ${ports.join('<br />') || '—'} |`;
  });
}

// Every document is typed steps. The forms differ in which types they use: one spells the flow out
// with `custom` steps, the other says the same thing with the specialized ones.
function authoredFormOf(report) {
  return report.steps.every((step) => step.type === 'custom') ? 'custom' : 'specialized';
}

function frontMatter({ docId, title, summary }) {
  return [
    '---',
    `id: ${docId}`,
    `title: ${JSON.stringify(title)}`,
    `sidebar_label: ${JSON.stringify(title.length > 40 ? docId : title)}`,
    `description: ${JSON.stringify(summary)}`,
    '---',
    '',
  ];
}

function glanceRows(definition, connectorTypes, connectorIds, features) {
  return [
    `| Initial step | ${code(definition.initial ?? definition.steps[0]?.name)} |`,
    `| Connector types | ${list(connectorTypes)} |`,
    `| Connectors | ${list(connectorIds)} |`,
    `| Shows | ${features.length ? features.join(', ') : 'the plain step shape'} |`,
  ];
}

function definitionBlock(workflow, lead) {
  return [
    lead,
    '',
    `\`\`\`json title="${workflow.relativeFile}" showLineNumbers`,
    JSON.stringify(workflow.document, null, 2),
    '```',
    '',
  ];
}

/** One workflow file on its own page; `twin` is the built-in revision written in the other form. */
function renderWorkflowPage(workflow, twin) {
  const { label, document, report, docId, authoredAs, relativeFile } = workflow;
  const definition = report.definition;
  const connectors = definition.steps.flatMap((step) => step.connectors ?? []);
  const connectorTypes = unique(connectors.map((connector) => connector.type)).sort();
  const connectorIds = unique(connectors.map((connector) => connector.id)).sort();
  const features = describeFeatures(definition);
  const summary = DESCRIPTIONS[docId] ?? summarize(definition, connectorTypes, features);

  const lines = [
    ...frontMatter({ docId, title: document.id, summary }),
    `<div className="tsh-caps">${label} · revision ${document.version} · ${authoredAs} steps</div>`,
    '',
    `→ ${summary}`,
    '',
    '## At a glance',
    '',
    '| | |',
    '| --- | --- |',
    `| Workflow id | ${code(document.id)} |`,
    `| Revision | ${document.version} |`,
    ...glanceRows(definition, connectorTypes, connectorIds, features),
    `| Steps | ${definition.steps.length} |`,
    `| Authored as | ${authoredAs === 'custom' ? '`custom` steps, which carry the compiled step verbatim' : 'specialized step types, compiled to the steps below when the workflow loads'} |`,
    ...(twin
      ? [
          `| The same flow as ${twin.authoredAs} steps | [${code(twin.docId)}](/fixtures/${twin.docId}) |`,
        ]
      : []),
    `| File | ${code(relativeFile)} |`,
    '',
  ];

  if (authoredAs === 'specialized') {
    lines.push(
      '## Authored steps',
      '',
      'The document as it is written: each step names its type, the steps it compiled to and where each of its ports leads.',
      '',
      '| Step | Type | Category | Compiles to | Ports |',
      '| --- | --- | --- | --- | --- |',
      ...authoredStepRows(report.steps),
      '',
    );
  }

  lines.push(
    '## Step map',
    '',
    authoredAs === 'specialized'
      ? 'The compiled form the engine runs, as the authored steps compile to it.'
      : 'Every step with what it collects, which connectors it calls and where each outcome leads.',
    '',
    ...STEP_MAP_HEADER,
    ...stepRows(definition),
    '',
    ...definitionBlock(
      workflow,
      '## Definition\n\nThe file as it ships, ready to copy into `workflows/users/` as a starting point.',
    ),
  );

  return {
    page: lines.join('\n'),
    manifest: {
      docId,
      scope: workflow.scope,
      version: document.version,
      name: document.id,
      authoredAs,
      stepCount: definition.steps.length,
      connectorTypes,
      connectorIds,
      summary,
      forms: [{ authoredAs, id: document.id, file: relativeFile }],
    },
  };
}

/**
 * The doc id of the same built-in flow in the other authored form: revision 1 and `-v2`. Undefined
 * when no such page exists.
 */
function twinDocIdOf(docId, docIds) {
  const candidate = docId.endsWith('-v2') ? docId.slice(0, -'-v2'.length) : `${docId}-v2`;

  return docIds.includes(candidate) ? candidate : undefined;
}

function loadWorkflows(ddl) {
  return SCOPES.flatMap(({ scope, label, directory }) =>
    readdirSync(resolve(repositoryRoot, directory))
      .filter((file) => file.endsWith('.workflow.json'))
      .sort()
      .map((file) => {
        const document = JSON.parse(readFileSync(resolve(repositoryRoot, directory, file), 'utf8'));
        // Refuses an invalid file the way the engine would at load; a fixture that stopped loading
        // must not be documented as if it worked.
        ddl.validateAndNormalizeWorkflow(document);
        const report = ddl.compileWorkflowReport(document);

        return {
          scope,
          label,
          file,
          relativeFile: `${directory}/${file}`,
          document,
          report,
          docId: basename(file, '.workflow.json'),
          authoredAs: authoredFormOf(report),
        };
      }),
  );
}

function generate() {
  const ddl = loadDdl();
  const manifest = [];

  mkdirSync(outputDir, { recursive: true });
  clean();

  const workflows = loadWorkflows(ddl);
  const fixtures = workflows.filter((workflow) => workflow.scope === 'fixtures');
  const builtIn = workflows.filter((workflow) => workflow.scope === 'built-in');
  const builtInDocIds = builtIn.map((workflow) => workflow.docId);

  const rendered = [
    ...fixtures.map((workflow) => renderWorkflowPage(workflow)),
    ...builtIn.map((workflow) =>
      renderWorkflowPage(
        workflow,
        builtIn.find((candidate) => candidate.docId === twinDocIdOf(workflow.docId, builtInDocIds)),
      ),
    ),
  ];

  for (const { page, manifest: entry } of rendered) {
    writeFileSync(join(outputDir, `${entry.docId}.mdx`), page);
    manifest.push(entry);
  }

  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${manifest.length} fixture pages written to ${outputDir}\n`);
}

if (process.argv.includes('--clean')) {
  clean();
} else {
  generate();
}
