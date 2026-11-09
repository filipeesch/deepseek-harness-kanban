/**
 * The words the two presentations of a board must agree on. Each is named once here
 * so the column board and the diagram cannot drift into describing the same thing
 * differently; a presentation that needs a new phrase asks for a new constant.
 */

/**
 * The sentence a stage presents when it has no cards to show. It stays one sentence
 * because neither presentation can tell an empty stage apart from a stage whose cards
 * a filter hid.
 */
export const EMPTY_STAGE_COPY = 'No matching tasks';

/**
 * The name of the action that creates a task, carried by the column board's button and
 * by the diagram's stage-header control as its accessible name and its tooltip, so an
 * assisted and a sighted reading hear one name whichever presentation they reached.
 */
export const NEW_TASK_LABEL = 'New task';
