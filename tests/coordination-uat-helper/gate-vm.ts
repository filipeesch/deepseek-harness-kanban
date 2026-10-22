/** In-memory Inspector transport. Executes the actual serialized gate in one isolated Host realm; no Native effects. */
import {createContext,runInContext,type Context} from 'node:vm';
export class GateSocket extends EventTarget {readyState=1;lose(){this.readyState=3;this.dispatchEvent(new Event('close'));}}
export class GateInspector {
 socket=new GateSocket();disposed=false;realm:Context;root:any;objects=new Map<string,{value:any;group:string}>();serial=0;calls:Array<{method:string;params:any}>=[];nativeCalls:string[]=[];
 deadlines:Array<(method:string,params:any)=>boolean>=[];corrupt?:(method:string,params:any,result:any)=>any;
 constructor(native:{command:(request:any)=>any;snapshot:()=>any}){
  this.realm=createContext({native:{command:(request:any)=>{this.nativeCalls.push('command:'+request.type);return native.command(request);},snapshot:()=>{this.nativeCalls.push('snapshot');return native.snapshot();}}});
  this.root=runInContext('(()=>{const root={get(name){if(name!=="kanbanController")throw new Error("UNEXPECTED_SERVICE");return{async command(request){return await native.command(request);},async snapshot(){return await native.snapshot();}};}};root.root=root;return root;})()',this.realm);
 }
 retain(value:any,group:string){const objectId='memory-host-'+(++this.serial);this.objects.set(objectId,{value,group});return{type:'object',objectId};}
 async call(method:string,params:any={}){if(this.disposed||this.socket.readyState!==1)throw new Error('PRIVATE_CONNECTION_BODY');this.calls.push({method,params});const server=this.execute(method,params),index=this.deadlines.findIndex(rule=>rule(method,params));if(index>=0){this.deadlines.splice(index,1);void server.catch(()=>{});throw Object.assign(new Error('PRIVATE_DEADLINE_BODY'),{code:'INSPECTOR_CLIENT_DEADLINE'});}const result=await server;return this.corrupt?this.corrupt(method,params,result):result;}
 async execute(method:string,params:any){
  if(method==='Runtime.enable')return{};
  if(method==='DOM.getDocument')return{root:{children:[{localName:'host',children:[{localName:'context',nodeId:1}]}]}};
  if(method==='DOM.resolveNode')return{object:this.retain(this.root,params.objectGroup)};
  if(method==='Runtime.releaseObjectGroup'){for(const[id,row]of this.objects)if(row.group===params.objectGroup)this.objects.delete(id);return{};}
  if(method!=='Runtime.callFunctionOn')throw new Error('UNKNOWN_PROTOCOL');
  try{const target=this.objects.get(params.objectId)?.value;if(!target)throw new Error('UNKNOWN_REFERENCE');const fn=runInContext('('+params.functionDeclaration+')',this.realm),args=(params.arguments??[]).map((arg:any)=>Object.hasOwn(arg,'objectId')?this.objects.get(arg.objectId)!.value:runInContext('JSON.parse('+JSON.stringify(JSON.stringify(arg.value))+')',this.realm));let value=fn.apply(target,args);if(params.awaitPromise)value=await value;if(params.returnByValue)return{result:value===undefined?{type:'undefined'}:{type:typeof value,value:JSON.parse(JSON.stringify(value))}};return{result:this.retain(value,params.objectGroup)};}catch{return{exceptionDetails:{text:'PRIVATE_EVALUATION_BODY'}};}
 }
 gate(){return[...this.objects.values()].find(row=>typeof row.value?.begin==='function')?.value;}
 close(){this.disposed=true;this.socket.lose();}
}
