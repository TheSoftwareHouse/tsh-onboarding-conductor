#!/usr/bin/env node

// Compiles a workflow document the way the engine will at load, and prints the result — the step
// form by default, or with `--nodes` each node's resolved steps and ports, or with `--normalized`
// the fully normalized definition. A hand-written document passes through unchanged, so this also
// answers "will this load?" for either authored form. Exits 1 with the reason and path on refusal.
//
// Usage: pnpm workflow:compile <file.json> [--nodes | --normalized]

const fs = require('node:fs');
const path = require('node:path');

const ddl = require(path.resolve(__dirname, '../packages/shared/ddl-schema/dist/index.js'));

const [file, ...flags] = process.argv.slice(2);

if (!file) {
  process.stderr.write('Usage: pnpm workflow:compile <file.json> [--nodes | --normalized]\n');
  process.exit(2);
}

const document = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

try {
  const report = ddl.isNodeGraphDefinition(document)
    ? ddl.compileNodeGraphReport(document)
    : { definition: document, nodes: null };
  const normalized = ddl.validateAndNormalizeWorkflow(document);
  const output = flags.includes('--normalized')
    ? normalized
    : flags.includes('--nodes')
      ? report.nodes
      : report.definition;

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  if (error instanceof ddl.WorkflowInvalidError) {
    const where = error.path === undefined ? '' : ` at ${error.path}`;
    process.stderr.write(`WORKFLOW_INVALID ${error.reason}${where}\n`);
    process.exit(1);
  }

  throw error;
}
