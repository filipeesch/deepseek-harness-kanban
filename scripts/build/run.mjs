import path from 'node:path';
import { clientBuildOptions, clientWrapper, declarationCommands, hostBuildOptions } from './plan.mjs';

/**
 * Build the installable package. Every effect is injected so the composition can
 * run unchanged from the build entry, the `prepare` lifecycle, and tests.
 */
export async function buildPackage({ root, manifest, build, mkdir, writeFile, exec }) {
  await mkdir(path.join(root, 'lib'), { recursive: true });
  await build(hostBuildOptions(root));
  const client = await build(clientBuildOptions(root));
  const output = client.outputFiles?.[0];
  if (output === undefined || typeof output.text !== 'string') {
    throw new Error('The client build produced no output.');
  }
  await writeFile(path.join(root, 'lib/client.js'), clientWrapper(manifest.name, output.text));
  for (const args of declarationCommands()) await exec(args, root);
  return ['lib/index.js', 'lib/remote.js', 'lib/client.js'].map(outputPath => path.join(root, outputPath));
}
