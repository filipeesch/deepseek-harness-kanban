import type {} from '@deepseek-ai/dsh-tools';
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session';
import type { QuestionAnswer, QuestionPage, QuestionRound } from '../../src/shared/types.js';
import type { QuestionEvent } from '../../src/questions/index.js';

function canonical<T extends SessionEventType>(seq: number, type: T, data: SessionEvent<T>['data']): QuestionEvent {
  // Brands are supplied by the native session log; fixtures preserve its published payload shapes.
  return { seq: seq as SessionEvent['seq'], type, data };
}
type CallId = SessionEvent<'tool/call'>['data']['callId'];
export const choice: QuestionPage = { question: 'Choose **storage**', type: 'exclusive', context: 'A *shared* choice.', weight: 'critical',
  options: [{ title: 'Local', description: 'Keep **files** locally.' }, { title: 'Remote', description: 'Use a remote service.' }], model_lean: 'Local', model_lean_reason: 'No extra service.' };
export const multi: QuestionPage = { question: 'Choose capabilities', type: 'non_exclusive', options: [{ title: 'Read', description: 'Read data.' }, { title: 'Write', description: 'Edit data.' }] };
export const free: QuestionPage = { question: 'Explain the constraints', type: 'freetext' };
export function call(seq: number, turn: number, callId: string, name = 'decision_request'): QuestionEvent {
  return canonical(seq, 'tool/call', { turn, step: 0, callId: callId as CallId, name, arguments: '{}' });
}
export function result(seq: number, turn: number, callId: string, page: QuestionPage = choice): QuestionEvent {
  return canonical(seq, 'tool/result', { turn, step: 0, message: { role: 'tool', id: ('result-' + callId) as SessionEvent<'tool/result'>['data']['message']['id'],
    source: { kind: 'tool', callId: callId as CallId }, toolCallId: callId as CallId, content: [] }, meta: { kind: 'kanban.question-page', version: 1, page: JSON.parse(JSON.stringify(page)) } });
}
export function end(seq: number, turn: number): QuestionEvent { return canonical(seq, 'turn/end', { turn, reason: { kind: 'completed' } }); }
export function human(seq: number): QuestionEvent { return canonical(seq, 'user/message', { role: 'user', id: ('human-' + seq) as SessionEvent<'user/message'>['data']['id'], source: { kind: 'user' }, content: [{ type: 'text', text: 'I prefer a normal text reply.' }] }); }
export function runtime(seq: number): QuestionEvent { return canonical(seq, 'user/message', { role: 'user', id: ('context-' + seq) as SessionEvent<'user/message'>['data']['id'], source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Runtime context changed.' }] }); }
export function ptcStart(seq: number, rootCallId: string, subCallId: string, parentCallId = rootCallId): QuestionEvent {
  return canonical(seq, 'tool/ptc-dispatch-start', { rootCallId: rootCallId as CallId, parentCallId: parentCallId as CallId, subCallId: subCallId as CallId, name: 'decision_request', arguments: {} });
}
export function ptcResult(seq: number, rootCallId: string, subCallId: string, page: QuestionPage = choice, parentCallId = rootCallId): QuestionEvent {
  return canonical(seq, 'tool/ptc-dispatch', { rootCallId: rootCallId as CallId, parentCallId: parentCallId as CallId, subCallId: subCallId as CallId,
    name: 'decision_request', arguments: {}, isError: false, content: [], meta: { kind: 'kanban.question-page', version: 1, page: JSON.parse(JSON.stringify(page)) } });
}
export function round(pages: QuestionPage[] = [choice], complete = true): QuestionRound {
  return { id: 'round-1', sessionId: 'session-1', turnId: '1', pages: pages.map((page, index) => ({ callId: 'page-' + index, sequence: index, page })), complete, answered: false };
}
export function answer(overrides: Partial<QuestionAnswer> = {}): QuestionAnswer { return { choices: [], text: '', other: '', notes: '', ...overrides }; }
