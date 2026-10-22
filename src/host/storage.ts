import type { Context } from '@deepseek-ai/cordis';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { BoardStateSchema, initialState } from '../domain/schema.js';
import type { StateStorage } from '../shared/ports.js';
import type { BoardState } from '../shared/types.js';
export async function openNativeStorage(ctx:Context):Promise<{storage:StateStorage;close:()=>Promise<void>}>{
 const spec=defineDomain({name:'kanban',version:1,layout:'single',tables:{},global:{schema:BoardStateSchema,initial:initialState()}});
 const domain=await ctx.storageDomain.open(spec);
 return {storage:{load:async()=>structuredClone(domain.global.get()),save:async(state:BoardState)=>{await domain.global.set(structuredClone(state));}},close:()=>domain.close()};
}
