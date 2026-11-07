import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { TypertRemoteInfo, TypertRemoteSpec } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
import type { z } from 'zod';

/** Zod runtime handed to the generated Remote definitions. */
type ZodRuntime=typeof z;

/**
 * Assemble a Remote definition together with its host contribution.
 *
 * This is the only module that imports the Typert protocol helper. The host entry
 * registers the contribution and the browser entry mounts the Remote definition,
 * so `scripts/build.mjs` inlines `@deepseek-ai/dsh-typert-protocol` into both
 * published bundles: a profile can carry an older copy of that package that does
 * not export `./remote-info`, and Node resolves the profile copy before the host
 * installation. Keep that package a build-time dependency only.
 * @param spec - generated method facts and Zod codec factories.
 * @param zod - Zod runtime used to build the named-input parsers.
 * @returns the mountable Remote definition and the contribution registered on the host.
 */
export function createTypertContribution(spec:TypertRemoteSpec,zod:ZodRuntime):{remote:TypertRemoteInfo;host:TypertContribution}{
 const remote=createTypertRemoteInfo(spec,zod);
 const host:TypertContribution={
  package:spec.package,
  face:'host',
  schemas:[],
  get invocations(){return remote.descriptors;},
  model:{services:[],events:[],objects:[]},
 };
 return {remote,host};
}
