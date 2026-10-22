import type { Context } from '@deepseek-ai/cordis';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { BoardStateSchema, initialState } from '../domain/schema.js';
import type { StateStorage } from '../shared/ports.js';
import type { BoardState } from '../shared/types.js';
const LegacyGlobalSchema=z.object({schemaVersion:z.literal(1),revision:z.number(),workflowYaml:z.string(),workflow:z.unknown(),projects:z.array(z.unknown()),tasks:z.array(z.unknown()),notes:z.array(z.unknown())}).passthrough();
const StoredGlobalSchema=z.union([LegacyGlobalSchema,BoardStateSchema]);
export async function openNativeStorage(ctx:Context):Promise<{storage:StateStorage;close:()=>Promise<void>}>{
 const spec=defineDomain({name:'kanban',version:1,layout:'single',tables:{},global:{schema:StoredGlobalSchema as never,initial:initialState()}});
 const domain=await ctx.storageDomain.open(spec);
 return {storage:{load:async()=>structuredClone(domain.global.get()),save:async(state:BoardState)=>{await domain.global.set(structuredClone(state));}},close:()=>domain.close()};
}
