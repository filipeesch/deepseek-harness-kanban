import { z } from 'zod';
import type { ColumnGroup, ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset, StagePosition, StageSize, TransitionRule } from '../../shared/types.js';
import { isDomainId } from '../validation.js';

/** The event format this installation writes. */
export const EVENT_FORMAT_VERSION = 1;

/** One change to a board workflow, before the log stamps its position and time. */
export type BoardChange =
  | { kind: 'workflow.replaced'; text: string }
  | { kind: 'workflow.field-changed'; field: 'name' | 'defaultView'; value: string | null }
  | { kind: 'workflow.initial-changed'; columnId: string }
  | { kind: 'stage.created'; stage: StageDefinition }
  | { kind: 'stage.field-changed'; key: string; field: 'name'; value: string }
  | { kind: 'stage.field-changed'; key: string; field: 'onEnterPrompt'; value: string | null }
  | { kind: 'stage.field-changed'; key: string; field: 'allowedTransitions'; value: TransitionRule[] | null }
  | { kind: 'stage.id-changed'; key: string; from: string; id: string }
  | { kind: 'stage.removed'; key: string }
  | { kind: 'stage.layout-set'; key: string; position: StagePosition | null; size: StageSize | null }
  | { kind: 'group.created'; group: ColumnGroup }
  | { kind: 'group.field-changed'; id: string; field: 'name'; value: string }
  | { kind: 'group.field-changed'; id: string; field: 'columns'; value: string[] }
  | { kind: 'group.removed'; id: string }
  | { kind: 'connection.set'; layout: ConnectionLayout }
  | { kind: 'connection.removed'; from: string; to: string };

/** One authored stage as an event carries it when the stage first appears. */
export interface StageDefinition {
  id: string;
  key: string;
  name: string;
  onEnterPrompt?: string;
  allowedTransitions?: TransitionRule[];
  position?: StagePosition;
  size?: StageSize;
}

/** A change with its position in one board's log. */
export type JournalEvent = BoardChange & { readonly seq: number; readonly at: string; readonly v: number };

/** The outcome of reading one stored event, which never throws. */
export type EventDecode =
  | { ok: true; event: JournalEvent }
  | { ok: false; reason: 'unsupported-version'; version: number }
  | { ok: false; reason: 'unknown-kind'; kind: string }
  | { ok: false; reason: 'invalid'; message: string };

const identifier = z.string().refine(isDomainId, 'Expected a safe identifier.');
const position = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const size = z.strictObject({ width: z.number().finite(), height: z.number().finite() });
const transition = z.union([
  identifier,
  z.strictObject({ to: identifier, when: z.string().optional() }),
]);
const transitionList = z.array(transition);
const anchor = z.strictObject({ side: z.enum(['top', 'right', 'bottom', 'left']), at: z.number().int().min(0).max(4) });
const segment = z.strictObject({ axis: z.enum(['x', 'y']), offset: z.number().finite() });
const connection = z.strictObject({ from: identifier, to: identifier, source: anchor.optional(), target: anchor.optional(), segments: z.array(segment).optional() });
const group = z.strictObject({ id: identifier, name: z.string().min(1), columnIds: z.array(identifier).min(1) });
const stage = z.strictObject({ id: identifier, key: identifier, name: z.string().min(1), onEnterPrompt: z.string().optional(), allowedTransitions: transitionList.optional(), position: position.optional(), size: size.optional() });

const stamped = { seq: z.number().int().min(0), at: z.string().min(1), v: z.literal(EVENT_FORMAT_VERSION) };
const shape = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('workflow.replaced'), text: z.string().min(1), ...stamped }),
  z.strictObject({ kind: z.literal('workflow.field-changed'), field: z.enum(['name', 'defaultView']), value: z.string().nullable(), ...stamped }),
  z.strictObject({ kind: z.literal('workflow.initial-changed'), columnId: identifier, ...stamped }),
  z.strictObject({ kind: z.literal('stage.created'), stage, ...stamped }),
  z.strictObject({ kind: z.literal('stage.field-changed'), key: identifier, field: z.enum(['name', 'onEnterPrompt', 'allowedTransitions']), value: z.union([z.string(), transitionList, z.null()]), ...stamped }),
  z.strictObject({ kind: z.literal('stage.id-changed'), key: identifier, from: identifier, id: identifier, ...stamped }),
  z.strictObject({ kind: z.literal('stage.removed'), key: identifier, ...stamped }),
  z.strictObject({ kind: z.literal('stage.layout-set'), key: identifier, position: position.nullable(), size: size.nullable(), ...stamped }),
  z.strictObject({ kind: z.literal('group.created'), group, ...stamped }),
  // One schema for both group fields: a discriminated union cannot repeat a kind.
  z.strictObject({ kind: z.literal('group.field-changed'), id: identifier, field: z.enum(['name', 'columns']), value: z.union([z.string().min(1), z.array(identifier).min(1)]), ...stamped }),
  z.strictObject({ kind: z.literal('group.removed'), id: identifier, ...stamped }),
  z.strictObject({ kind: z.literal('connection.set'), layout: connection, ...stamped }),
  z.strictObject({ kind: z.literal('connection.removed'), from: identifier, to: identifier, ...stamped }),
]);

/** Every kind this installation understands, so an unknown one is reported instead of guessed. */
export const EVENT_KINDS: readonly string[] = [
  'workflow.replaced', 'workflow.field-changed', 'workflow.initial-changed',
  'stage.created', 'stage.field-changed', 'stage.id-changed', 'stage.removed', 'stage.layout-set',
  'group.created', 'group.field-changed', 'group.removed',
  'connection.set', 'connection.removed',
];

/** Serialize one event as the log stores it. */
export function encodeEvent(event: JournalEvent): Record<string, unknown> {
  return { ...event, v: EVENT_FORMAT_VERSION };
}

/**
 * Read one stored event. A kind or version this installation does not know is
 * reported as such, because skipping it would diverge silently.
 */
export function decodeEvent(raw: unknown): EventDecode {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'invalid', message: 'An event must be a mapping.' };
  const value = raw as Record<string, unknown>;
  const version = value.v;
  if (typeof version !== 'number' || !Number.isInteger(version)) return { ok: false, reason: 'invalid', message: 'An event must state an integer format version.' };
  if (version > EVENT_FORMAT_VERSION) return { ok: false, reason: 'unsupported-version', version };
  const kind = value.kind;
  if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind)) return { ok: false, reason: 'unknown-kind', kind: typeof kind === 'string' ? kind : String(kind) };
  const parsed = shape.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: 'invalid', message: issue === undefined ? 'Invalid event.' : issue.path.join('.') + ' ' + issue.message };
  }
  const event = parsed.data as unknown as JournalEvent;
  const mismatch = fieldValueMismatch(event);
  if (mismatch !== null) return { ok: false, reason: 'invalid', message: mismatch };
  return { ok: true, event: normalize(event) };
}

/**
 * The value a decoded event carries must match the field it names, or a reducer would
 * build a patch the editor cannot read. The codec validates the two independently,
 * so this pairing is checked here.
 */
function fieldValueMismatch(event: JournalEvent): string | null {
  if (event.kind === 'stage.field-changed') {
    if (event.field === 'name' && typeof event.value !== 'string') return 'A stage name change requires text.';
    if (event.field === 'onEnterPrompt' && !(typeof event.value === 'string' || event.value === null)) return 'A stage instruction change requires text or null.';
    if (event.field === 'allowedTransitions' && !(event.value === null || Array.isArray(event.value))) return 'A stage transition change requires a list or null.';
  }
  if (event.kind === 'group.field-changed') {
    if (event.field === 'name' && typeof event.value !== 'string') return 'A group name change requires text.';
    if (event.field === 'columns' && !Array.isArray(event.value)) return 'A group membership change requires a list.';
  }
  return null;
}

/** A decoded event keeps the authored shapes the domain uses, without codec artifacts. */
function normalize(event: JournalEvent): JournalEvent {
  if (event.kind === 'stage.created') {
    const { stage } = event;
    return {
      ...event,
      stage: {
        ...stage,
        ...(stage.allowedTransitions === undefined ? {} : { allowedTransitions: normalizeTransitions(stage.allowedTransitions) }),
      },
    };
  }
  if (event.kind === 'stage.field-changed' && event.field === 'allowedTransitions' && Array.isArray(event.value)) {
    return { ...event, value: normalizeTransitions(event.value) };
  }
  if (event.kind === 'connection.set') {
    const layout: ConnectionLayout = { from: event.layout.from, to: event.layout.to };
    const source = event.layout.source as ConnectionAnchor | undefined;
    const target = event.layout.target as ConnectionAnchor | undefined;
    const segments = event.layout.segments as ConnectionSegmentOffset[] | undefined;
    if (source !== undefined) layout.source = source;
    if (target !== undefined) layout.target = target;
    if (segments !== undefined) layout.segments = segments.map(segment => ({ axis: segment.axis, offset: segment.offset }));
    return { ...event, layout };
  }
  return event;
}

function normalizeTransitions(value: readonly unknown[]): TransitionRule[] {
  return value.map(entry => {
    if (typeof entry === 'string') return { to: entry };
    const rule = entry as { to: string; when?: string };
    const condition = typeof rule.when === 'string' ? rule.when.trim() : '';
    return condition.length > 0 ? { to: rule.to, when: condition } : { to: rule.to };
  });
}
