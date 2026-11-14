import type { Workflow } from '../shared/types.js';

/** How many bytes one UTF-8 character costs, without a Node-only global in a client bundle. */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** How one stage's authored text costs, as a caller can see it before saving. */
export interface StageSizeFact {
  readonly stage: string;
  readonly instructionChars?: number;
  readonly instructionBytes?: number;
  /** An estimate, never a tokenizer count: about four bytes per token. */
  readonly instructionTokensEstimate?: number;
  readonly sourceBytes?: number;
}

/** The average bytes one model token costs for authored prose; an estimate only. */
export const BYTES_PER_TOKEN_ESTIMATE = 4;

/** One stage's authored size, or undefined when the stage authors no text. */
export function stageSize(stage: { readonly id: string; readonly onEnterPrompt?: string; readonly deterministic?: { readonly code?: string } }): StageSizeFact | undefined {
  const instruction = stage.onEnterPrompt;
  const code = stage.deterministic?.code;
  if (instruction === undefined && code === undefined) return undefined;
  const instructionBytes = instruction === undefined ? undefined : utf8Length(instruction);
  return {
    stage: stage.id,
    ...(instruction === undefined ? {} : {
      instructionChars: instruction.length,
      instructionBytes: instructionBytes!,
      instructionTokensEstimate: Math.ceil(instructionBytes! / BYTES_PER_TOKEN_ESTIMATE),
    }),
    ...(code === undefined ? {} : { sourceBytes: utf8Length(code) }),
  };
}

/** The authored size of every stage the workflow names, in authored order. */
export function workflowStageSizes(workflow: Workflow): StageSizeFact[] {
  return workflow.columns.flatMap(column => {
    const fact = stageSize(column);
    return fact === undefined ? [] : [fact];
  });
}
