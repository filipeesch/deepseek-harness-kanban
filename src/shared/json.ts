export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export function json(value:unknown):Json {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Nonfinite JSON number');return value;}
 if(Array.isArray(value))return value.map(json);
 if(typeof value==='object'){const result:{[key:string]:Json}={};for(const [key,item]of Object.entries(value)){if(item!==undefined)Object.defineProperty(result,key,{value:json(item),enumerable:true,writable:true,configurable:true});}return result;}
 throw new TypeError('Only JSON values can cross the tool boundary.');
}
