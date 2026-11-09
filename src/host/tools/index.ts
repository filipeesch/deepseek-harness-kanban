import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { KanbanError } from '../../shared/errors.js';
import { discoveryTools } from './discovery.js';
import { cardTools } from './cards.js';
import { noteTools } from './notes.js';
import { boardTools } from './boards.js';
import { questionTools } from './questions.js';
import { transitionTools } from './transitions.js';

export function productToolDefinitions(app:KanbanApp,boards:BoardAdministration=app.boards):ToolDefinition[]{
 return [
  ...discoveryTools(app,boards),
  ...cardTools(app),
  ...noteTools(app),
  ...boardTools(app,boards),
  ...transitionTools(app),
  ...questionTools(),
 ];
}

export function registerProductTools(ctx:Context,app:KanbanApp):()=>void{
 const disposers:Array<()=>void>=[];
 try{for(const definition of productToolDefinitions(app)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');disposers.push(ctx.tools.register(definition));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}
