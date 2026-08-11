/**
 * Writes the committed onboarding workflow contract from the field-type registry.
 * Run through `pnpm --filter @tsh/ddl-schema schema:generate`, which compiles `dist` first.
 */
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const { buildWorkflowJsonSchema } = require('../dist/schema/workflow-json-schema.builder.js');

const outputPath = path.resolve(__dirname, '..', 'onboarding-workflow.schema.json');

const main = async () => {
  const schema = buildWorkflowJsonSchema();
  const prettierOptions = await prettier.resolveConfig(outputPath);
  // Serialized without indentation so Prettier — not JSON.stringify — decides every line break.
  const content = await prettier.format(JSON.stringify(schema), {
    ...(prettierOptions ?? {}),
    parser: 'json',
    filepath: outputPath,
  });

  fs.writeFileSync(outputPath, content, 'utf8');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
