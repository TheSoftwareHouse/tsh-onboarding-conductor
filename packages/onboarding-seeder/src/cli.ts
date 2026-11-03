import { USAGE, parseCliOptions } from './cli-options';
import { DEFAULT_MANIFEST_PATH, writeManifest } from './manifest/manifest-writer';
import { runSeed } from './seed/run-seed';

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  const command = parseCliOptions(argv, env);

  if (command.kind === 'help') {
    console.log(USAGE);
    return;
  }

  const manifest = await runSeed(command.options);
  await writeManifest(manifest);

  const counts = new Map<string, number>();
  for (const { key } of manifest.scenarios) {
    const family = key.replace(/-\d+$/, '');
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  console.log(
    `Seeded ${manifest.scenarios.length} onboardings of ${manifest.workflow.id} v${manifest.workflow.version} (seed ${manifest.seed}):`,
  );
  for (const [family, count] of counts) {
    console.log(`  ${family.padEnd(40)} ${count}`);
  }
  if (manifest.spreadDays !== undefined) {
    console.log(`Timestamps spread over the last ${manifest.spreadDays} days.`);
  }
  console.log(`Manifest: ${DEFAULT_MANIFEST_PATH}`);
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
