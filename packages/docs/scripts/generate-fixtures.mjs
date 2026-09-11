#!/usr/bin/env node
// Writes the fixture pages and the manifest the gallery and the sidebar read. An example in
// workflows/fixtures ships as two files, `<name>-typed.workflow.json` written with the specialized
// step types and `<name>.workflow.json` written as `custom` steps, and gets ONE page: the specialized
// form first, then the same flow as `custom` steps and what to do to write it that way. A built-in
// workflow in workflows/built-in gets a page per file, each naming the revision in the other form.
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

const TYPED_SUFFIX = '-typed';

/** One sentence per workflow, verified against the file it describes. Falls back to the derived summary. */
const DESCRIPTIONS = {
  base: 'The smallest complete flow: collect an email, have the terms accepted, approve. Two stand-in KYC connectors show where a provider call sits.',
  'conditional-fields-and-transitions':
    'Fields that appear only when an earlier answer makes them relevant, transitions guarded by conditions, and a manual review fork.',
  'connector-fallback':
    'An email connector with retries and a fallback declaration, so a second provider takes over when the first runs out of attempts.',
  'file-upload':
    'One document upload field, exercising the reserve-then-complete flow against object storage.',
  'http-request':
    'Calling a JSON API from configuration alone with the generic http_request connector.',
  'manual-review':
    'A step that parks the onboarding for an operator, with approve, reject and invalid each leading somewhere.',
  'manual-smtp': 'Sending an email through a plain SMTP server, which MailHog catches locally.',
  scoring:
    'Named scores accumulated by rules across phone verification, an identity check and a manual review, with transitions that branch on them.',
  'sendgrid-email': 'Sending an email through SendGrid.',
  'sumsub-kyc':
    'An identity check whose verdict arrives on a provider callback, with document uploads and a manual review fork.',
  'twilio-verify': 'A one-time code sent and checked through Twilio Verify.',
  'eu-b2c-individual-kyc-eea':
    'The production reference flow written as custom steps: EU B2C individual KYC across the EEA, where the applicant chooses between a passport and a national ID card.',
  'eu-b2c-individual-kyc-eea-v2':
    'The same flow written with specialized step types, which compiles to the steps of revision 1 when it loads.',
};

/**
 * Why an example's two forms compile to different steps, for the examples where they do. Each
 * sentence is the one `packages/engine/src/workflows/checked-in-workflows.spec.ts` asserts; the
 * steps concerned are computed below, not written here.
 */
const DIFFERENCES = {
  'conditional-fields-and-transitions':
    'A `manual-review` step always keeps a stray submit where it was, so the specialized form carries a `success` arm on each review step that the `custom` form leaves out.',
  'twilio-verify':
    '`otp-verify` generates the re-send step itself and routes an expired or unknown challenge to it, so the specialized form gains `request_code_resend` and the arm that leads there.',
  scoring:
    '`otp-verify` generates the re-send step and its arm, and the phone number is collected on `collect_profile` rather than on `request_code`. `identity-profile`, `document-capture` and `kyc-identity-verification` shape the fields they collect and the document table the connector receives: the document fields are `idCardFront` and `idCardBack`, their validations are the steps’ own, and the issuing country comes from the `country` field rather than a fixed `POL`. `manual-review` keeps its stray submit arm.',
  'sumsub-kyc':
    '`document-capture` and `kyc-identity-verification` shape the fields they collect and the document table the connector receives: the document fields are `idCardFront` and `idCardBack`, their validations are the steps’ own, and the issuing country comes from the `country` field rather than a fixed `POL`. `manual-review` keeps its stray submit arm.',
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

const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys(value[key])]),
        )
      : value;
const same = (left, right) => JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));

/**
 * How two forms of one flow compare once compiled, on the normalized definition the engine runs —
 * the comparison `checked-in-workflows.spec.ts` makes, with the document's own id and name set aside.
 */
function compareCompiled(specialized, custom) {
  const names = unique([
    ...specialized.normalized.steps.map((step) => step.name),
    ...custom.normalized.steps.map((step) => step.name),
  ]);
  const differing = names.filter(
    (name) => !same(specialized.normalized.stepsByName[name], custom.normalized.stepsByName[name]),
  );
  const onlySpecialized = differing.filter((name) => !custom.normalized.stepsByName[name]);
  const onlyCustom = differing.filter((name) => !specialized.normalized.stepsByName[name]);
  const topLevel = ['initial', 'webhook', 'scores'].filter(
    (key) => !same(specialized.normalized[key], custom.normalized[key]),
  );

  return {
    identical: differing.length === 0 && topLevel.length === 0,
    differing,
    onlySpecialized,
    onlyCustom,
    topLevel,
  };
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

/** An example: the flow in specialized steps first, then the same flow as `custom` steps. */
function renderExamplePage({ docId, label, specialized, custom }) {
  const definition = specialized.report.definition;
  const connectors = definition.steps.flatMap((step) => step.connectors ?? []);
  const connectorTypes = unique(connectors.map((connector) => connector.type)).sort();
  const connectorIds = unique(connectors.map((connector) => connector.id)).sort();
  const features = describeFeatures(definition);
  const summary = DESCRIPTIONS[docId] ?? summarize(definition, connectorTypes, features);
  const title = custom.document.name;
  const comparison = compareCompiled(specialized, custom);

  const lines = [
    ...frontMatter({ docId, title, summary }),
    `<div className="tsh-caps">${label} · revision ${specialized.document.version} · specialized and \`custom\` steps</div>`,
    '',
    `→ ${summary}`,
    '',
    `The example ships twice. ${code(specialized.document.id)} is written with the specialized step types and is the form to start from; ${code(custom.document.id)} is the same flow written as \`custom\` steps, one hand-written compiled step each. Both load side by side, so an onboarding can be started from either id.`,
    '',
    '## At a glance',
    '',
    '| | |',
    '| --- | --- |',
    `| Workflow ids | ${code(specialized.document.id)} in specialized steps · ${code(custom.document.id)} in \`custom\` steps |`,
    `| Revision | ${specialized.document.version} |`,
    ...glanceRows(definition, connectorTypes, connectorIds, features),
    `| Steps | ${specialized.report.steps.length} specialized steps compiling to ${definition.steps.length} · ${custom.report.steps.length} \`custom\` steps |`,
    `| Files | ${code(specialized.relativeFile)} · ${code(custom.relativeFile)} |`,
    '',
    '## Written with specialized steps',
    '',
    'Each step names what it is for and the engine derives the rest when the file loads: the fields a type collects, the status the onboarding shows while it waits there, the outcomes it can end with. `edges` wires each outcome, called a port, to the step it leads to.',
    '',
    '| Step | Type | Category | Compiles to | Ports |',
    '| --- | --- | --- | --- | --- |',
    ...authoredStepRows(specialized.report.steps),
    '',
    '### Step map',
    '',
    'The compiled form the engine runs, as the authored steps compile to it: every step with what it collects, which connectors it calls and where each outcome leads.',
    '',
    ...STEP_MAP_HEADER,
    ...stepRows(definition),
    '',
    ...definitionBlock(
      specialized,
      '### Definition\n\nThe file as it ships, ready to copy into `workflows/users/` as a starting point.',
    ),
    '## The same flow as `custom` steps',
    '',
    'A `custom` step carries a compiled step verbatim. Its `config` holds the `status`, `data`, `connectors` and `transitions` a row of the step map shows, and it needs no `edges` because every transition names its target. That is the form for a step none of the specialized types describes, and any flow can be written in it: run `pnpm workflow:compile` on the specialized file to print the compiled steps, then run it again on that output with `--from-untyped` to wrap each in a `custom` step.',
    '',
    '```bash',
    `$ pnpm workflow:compile ${specialized.relativeFile} > compiled.json`,
    '$ pnpm workflow:compile compiled.json --from-untyped',
    '```',
    '',
    ...(comparison.identical
      ? [
          `That is how ${code(custom.relativeFile)} relates to the file above: apart from its \`id\` and \`name\`, it is what those two commands print, and both files compile to the step map above.`,
          '',
        ]
      : [
          `${code(custom.relativeFile)} writes the flow that way by hand, and the two forms do not compile to exactly the same steps. ${DIFFERENCES[docId] ?? 'The specialized types derive parts of a step that the `custom` form spells out differently.'}`,
          '',
          `Steps that compile differently: ${list(comparison.differing.filter((name) => !comparison.onlySpecialized.includes(name) && !comparison.onlyCustom.includes(name)))}.${comparison.onlySpecialized.length ? ` Only in the specialized form: ${list(comparison.onlySpecialized)}.` : ''}${comparison.onlyCustom.length ? ` Only in the \`custom\` form: ${list(comparison.onlyCustom)}.` : ''}${comparison.topLevel.length ? ` The definitions also differ in ${list(comparison.topLevel)}.` : ''} Those steps as the \`custom\` form compiles them:`,
          '',
          ...STEP_MAP_HEADER,
          ...custom.report.definition.steps
            .filter((step) => comparison.differing.includes(step.name))
            .map(stepRow),
          '',
        ]),
    ...definitionBlock(custom, '### Definition'),
  ];

  return {
    page: lines.join('\n'),
    manifest: {
      docId,
      scope: specialized.scope,
      version: specialized.document.version,
      name: title,
      authoredAs: 'specialized and custom',
      stepCount: definition.steps.length,
      connectorTypes,
      connectorIds,
      summary,
      forms: [specialized, custom].map((workflow) => ({
        authoredAs: workflow.authoredAs,
        id: workflow.document.id,
        file: workflow.relativeFile,
      })),
    },
  };
}

/** One workflow file on its own page — a built-in revision, or an example that ships in one form only. */
function renderWorkflowPage(workflow, twin) {
  const { label, document, report, docId, authoredAs, relativeFile } = workflow;
  const definition = report.definition;
  const connectors = definition.steps.flatMap((step) => step.connectors ?? []);
  const connectorTypes = unique(connectors.map((connector) => connector.type)).sort();
  const connectorIds = unique(connectors.map((connector) => connector.id)).sort();
  const features = describeFeatures(definition);
  const summary = DESCRIPTIONS[docId] ?? summarize(definition, connectorTypes, features);

  const lines = [
    ...frontMatter({ docId, title: document.name, summary }),
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
    `| The same flow as ${twin ? `${twin.authoredAs} steps` : 'the other form'} | ${twin ? `[${code(twin.docId)}](/fixtures/${twin.docId})` : '—'} |`,
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
      name: document.name,
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
        const normalized = ddl.validateAndNormalizeWorkflow(document);
        const report = ddl.compileWorkflowReport(document);

        return {
          scope,
          label,
          file,
          relativeFile: `${directory}/${file}`,
          document,
          normalized,
          report,
          docId: basename(file, '.workflow.json'),
          authoredAs: authoredFormOf(report),
        };
      }),
  );
}

/** Pairs each example's two files under the plain name; a file without its counterpart stands alone. */
function groupExamples(workflows) {
  const byDocId = new Map(workflows.map((workflow) => [workflow.docId, workflow]));
  const pages = [];

  for (const workflow of workflows) {
    if (workflow.docId.endsWith(TYPED_SUFFIX)) {
      const plain = byDocId.get(workflow.docId.slice(0, -TYPED_SUFFIX.length));
      if (plain && plain.authoredAs === 'custom' && workflow.authoredAs === 'specialized') {
        continue; // rendered with its `custom` counterpart below
      }
    }

    const typed = byDocId.get(`${workflow.docId}${TYPED_SUFFIX}`);
    if (workflow.authoredAs === 'custom' && typed?.authoredAs === 'specialized') {
      pages.push({
        docId: workflow.docId,
        label: workflow.label,
        specialized: typed,
        custom: workflow,
      });
    } else {
      pages.push({ docId: workflow.docId, single: workflow });
    }
  }

  return pages;
}

function generate() {
  const ddl = loadDdl();
  const manifest = [];

  mkdirSync(outputDir, { recursive: true });
  clean();

  const workflows = loadWorkflows(ddl);
  const examples = groupExamples(workflows.filter((workflow) => workflow.scope === 'fixtures'));
  const builtIn = workflows.filter((workflow) => workflow.scope === 'built-in');
  const builtInDocIds = builtIn.map((workflow) => workflow.docId);

  const rendered = [
    ...examples.map((page) =>
      page.single ? renderWorkflowPage(page.single) : renderExamplePage(page),
    ),
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
