#!/usr/bin/env node

// Compiles a workflow document the way the engine will at load, and prints the result — the
// compiled form by default, or with `--report` each step's compiled steps and ports, or with
// `--normalized` the fully normalized definition. So this also answers "will this load?", and exits
// 1 with the reason and path on refusal. A document still written as untyped steps — the compiled
// shape, with no `type` on a step — is refused like the engine refuses it; `--from-untyped` prints
// instead the typed document it converts to, which is the document to save in its place.
//
// Usage: pnpm workflow:compile <file.json> [--report | --normalized | --from-untyped]

const fs = require('node:fs');
const path = require('node:path');

const ddl = require(path.resolve(__dirname, '../packages/shared/ddl-schema/dist/index.js'));

const [file, ...flags] = process.argv.slice(2);

if (!file) {
  process.stderr.write(
    'Usage: pnpm workflow:compile <file.json> [--report | --normalized | --from-untyped]\n',
  );
  process.exit(2);
}

const document = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

try {
  if (flags.includes('--from-untyped')) {
    const converted = ddl.convertUntypedSteps(document);
    // Proven loadable before it is printed, so what comes out is a document the engine accepts.
    ddl.validateAndNormalizeWorkflow(converted);
    process.stdout.write(`${JSON.stringify(converted, null, 2)}\n`);
    process.exit(0);
  }

  const report = ddl.compileWorkflowReport(document);
  const normalized = ddl.validateAndNormalizeWorkflow(document);
  const output = flags.includes('--normalized')
    ? normalized
    : flags.includes('--report')
      ? report.steps
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
