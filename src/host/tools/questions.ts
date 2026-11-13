import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { json } from '../../shared/json.js';
import { invariant } from '../../shared/errors.js';
import { validateQuestionPage } from '../../questions/validation.js';

/** Model-facing guidance: send every page the round needs, then end the turn so the user can submit. */
const QUESTION_TOOL_DESCRIPTION='Add ONE structured question page to this conversation round. Call this once per page, sending every page the round needs in this turn. ALWAYS end your turn after finishing all pages of the round: the user cannot submit until the turn ends, and continuing to write keeps Submit unavailable. This tool returns immediately; the user\'s reply arrives as one ordinary message in your next turn. The form is optional UX: users can dismiss the round from the footer and answer normally in chat; dismissal sends no chat message and persists across reload/replay. Never create decision records. Choices belong in options, not embedded in question text; freetext omits options. A recommendation must match an option title.';

/** The per-call result repeats only the short rule so it cannot dilute the turn-ending instruction. */
const QUESTION_TOOL_RESULT='ALWAYS end your turn after finishing all pages of the round.';

export function questionTools():ToolDefinition[]{
 return [
  defineTool({name:'decision_request',description:QUESTION_TOOL_DESCRIPTION,parameters:{question:{type:'string',required:true},type:{type:'string',enum:['exclusive','non_exclusive','freetext'],required:true},context:{type:'string'},weight:{type:'string',enum:['critical','medium','easy']},model_lean:{type:'string'},model_lean_reason:{type:'string'},answers_affect_followup:{type:'boolean'},options:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string',required:true},description:{type:'string',required:true}}}}},output:{schema:{type:'json'},render:()=>[{type:'text',text:QUESTION_TOOL_RESULT}],presentationMeta:(_args,value)=>value},isConcurrencySafe:()=>false,execute:async(args,exec)=>{invariant(exec.agent,'MISSING_SESSION','Question pages require an owning native conversation.');exec.signal.throwIfAborted();return json({kind:'kanban.question-page',version:1,page:validateQuestionPage(args)});}}),
 ];
}
