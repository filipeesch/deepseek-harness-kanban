import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { json } from '../../shared/json.js';
import { invariant } from '../../shared/errors.js';
import { validateQuestionPage } from '../../questions/validation.js';

export function questionTools():ToolDefinition[]{
 return [
  defineTool({name:'decision_request',description:'Add ONE structured question page to this conversation round. This tool returns immediately. Ask pages sequentially, then finish the native turn so the user can submit the complete round. The form is optional UX: users can dismiss the round from the footer and answer normally in chat; dismissal sends no chat message and persists across reload/replay. Never create decision records. Choices belong in options, not embedded in question text; freetext omits options. A recommendation must match an option title.',parameters:{question:{type:'string',required:true},type:{type:'string',enum:['exclusive','non_exclusive','freetext'],required:true},context:{type:'string'},weight:{type:'string',enum:['critical','medium','easy']},model_lean:{type:'string'},model_lean_reason:{type:'string'},answers_affect_followup:{type:'boolean'},options:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string',required:true},description:{type:'string',required:true}}}}},output:{schema:{type:'json'},render:()=>[{type:'text',text:'Question page added. Add any remaining questions, then finish this turn. The user will reply with one ordinary text message.'}],presentationMeta:(_args,value)=>value},isConcurrencySafe:()=>false,execute:async(args,exec)=>{invariant(exec.agent,'MISSING_SESSION','Question pages require an owning native conversation.');exec.signal.throwIfAborted();return json({kind:'kanban.question-page',version:1,page:validateQuestionPage(args)});}}),
 ];
}
