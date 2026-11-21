import type { RoutingPolicy } from '../domain/stage-kind.js';
import type { OrientationExit, StageOrientation, StageReference } from '../domain/stage-orientation.js';

/** The size the orientation block keeps before it drops the exit destinations' responsibilities. */
export const ORIENTATION_BLOCK_BUDGET = 4 * 1024;

/** What each routing policy means, stated as a fact about the stage and never as an instruction. */
const ROUTING_FACT: Record<RoutingPolicy, string> = {
  configured: 'the stage configures its exits',
  unrestricted: 'the stage authors no restriction, so every other stage is an exit',
  empty: 'the stage permits no exit',
  scripted: 'the stage runs a program that selects one of its named exits',
  decision: 'the stage waits for a person to choose one of its options',
};

const OMITTED = "Exit destinations' responsibilities are omitted for length; read them with get_workflow_summary.";

/** A multi-line authored text, kept whole, with its continuation lines indented under its label. */
function block(text: string): string {
  return text.trim().split('\n').map((line, index) => (index === 0 ? line : '  ' + line)).join('\n');
}

function identity(reference: StageReference): string {
  return reference.name + ' (' + reference.id + '), ' + reference.kind;
}

function exitText(exit: OrientationExit, withResponsibility: boolean): string {
  let line = '- ';
  if (exit.exit !== undefined) line += 'exit ' + exit.exit + ': ';
  else if (exit.option !== undefined) line += 'option ' + exit.option.id + ' (' + exit.option.title + '): ';
  line += identity(exit.to);
  if (exit.condition !== undefined) line += '. Condition: ' + block(exit.condition);
  if (withResponsibility && exit.to.responsibility !== undefined) line += '\n  Responsibility: ' + block(exit.to.responsibility);
  return line;
}

/**
 * The orientation block a stage-instruction delivery or a stage notice opens with:
 * the stage, its kind and responsibility, how it routes, and its exits with their
 * conditions. It states facts only. The current stage's responsibility and every
 * condition are always whole; when the exits' destination responsibilities would
 * push the block past its budget they are dropped together and the block says so.
 */
export function renderOrientationBlock(orientation: StageOrientation, budget: number = ORIENTATION_BLOCK_BUDGET): string {
  const { stage, routing, exits } = orientation;
  const head = [
    'Stage orientation (facts from the active workflow):',
    'Stage: ' + identity(stage),
    'Responsibility: ' + (stage.responsibility === undefined ? 'none authored' : block(stage.responsibility)),
    'Routing: ' + ROUTING_FACT[routing],
    exits.length === 0 ? 'Exits: none' : 'Exits:',
  ];
  const complete = [...head, ...exits.map(exit => exitText(exit, true))].join('\n');
  if (Buffer.byteLength(complete) <= budget) return complete;
  const trimmed = [...head, ...exits.map(exit => exitText(exit, false))];
  if (exits.some(exit => exit.to.responsibility !== undefined)) trimmed.push(OMITTED);
  return trimmed.join('\n');
}
