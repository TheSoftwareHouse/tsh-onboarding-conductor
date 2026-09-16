// The OpenAPI plugin hardcodes `sidebar_label: Introduction` on the info page, and Docusaurus lets a
// doc's front matter win over the label its sidebar entry carries. Rewriting the front matter after
// generation is therefore the only way to label the page; `api:generate` runs this last.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('../docs/api/', import.meta.url));
const LABEL = 'From the OpenAPI document';

const infoPages = readdirSync(apiDir).filter((name) => name.endsWith('.info.mdx'));

if (infoPages.length === 0) {
  throw new Error(`No *.info.mdx under ${apiDir}; run gen-api-docs first`);
}

for (const file of infoPages) {
  const path = join(apiDir, file);
  const source = readFileSync(path, 'utf8');

  if (!/^sidebar_label: /m.test(source)) {
    throw new Error(`${file} has no sidebar_label front matter to rewrite`);
  }

  const updated = source.replace(/^sidebar_label: .*$/m, `sidebar_label: ${LABEL}`);

  if (updated === source) {
    console.log(`${file}: sidebar_label already "${LABEL}"`);
    continue;
  }

  writeFileSync(path, updated);
  console.log(`${file}: sidebar_label set to "${LABEL}"`);
}
