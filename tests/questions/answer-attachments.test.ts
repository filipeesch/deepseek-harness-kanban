import { describe, expect, it } from 'vitest';
import { addPageAttachment, addPickedAttachments, addRoundAttachment, emptyDraft, hasContent, orderedAttachments, pageAttachments, removePageAttachment, removeRoundAttachment, restoreDraft, toStoredDraft } from '../../src/questions/draft.js';
import { formatAnswers } from '../../src/questions/validation.js';
import { choice, free, round } from './fixtures.js';

const file = (id: string) => ({ id, name: id + '.txt', bytes: 3 });

describe('answer attachments in a draft', () => {
  it('attaches a file to one page without touching the others', () => {
    let draft = emptyDraft('round-1');
    draft = addPageAttachment(draft, 'page-0', file('a'));
    expect(pageAttachments(draft, 'page-0').map(value => value.id)).toEqual(['a']);
    expect(pageAttachments(draft, 'page-1')).toEqual([]);
  });

  it('places a selection that resolved late where it was picked', () => {
    // Pick ranks: a was picked first, b second, but b was stored first.
    const ranks = new Map([['a', 1], ['b', 2]]);
    const rank = (id: string) => ranks.get(id) ?? 0;
    let draft = emptyDraft('round-1');
    draft = addPickedAttachments(draft, [{ attachment: file('b'), slide: { kind: 'page', callId: 'page-0' } }], rank, 2);
    draft = addPickedAttachments(draft, [
      { attachment: file('a'), slide: { kind: 'page', callId: 'page-0' } },
      { attachment: file('a2'), slide: { kind: 'notes' } },
    ], id => ranks.get(id) ?? (id === 'a2' ? 1 : 0), 1);
    // The retried selection keeps its own source order and predates the later one.
    expect(orderedAttachments(draft).map(value => value.id)).toEqual(['a', 'a2', 'b']);
    expect(draft.attachmentOrder).toEqual(['a', 'a2', 'b']);
  });

  it('detaches one page file and leaves the page answer intact', () => {
    let draft = addPageAttachment(emptyDraft('round-1'), 'page-0', file('a'));
    draft = removePageAttachment(draft, 'page-0', 'a');
    expect(pageAttachments(draft, 'page-0')).toEqual([]);
    expect(draft.pageAttachments['page-0']).toBeUndefined();
  });

  it('detaches one round file and keeps the others', () => {
    let draft = addRoundAttachment(addRoundAttachment(emptyDraft('round-1'), file('a')), file('b'));
    draft = removeRoundAttachment(draft, 'a');
    expect(draft.roundAttachments.map(value => value.id)).toEqual(['b']);
  });

  it('counts a file as draft content even with no text', () => {
    expect(hasContent(addRoundAttachment(emptyDraft('round-1'), file('a')))).toBe(true);
    expect(hasContent(addPageAttachment(emptyDraft('round-1'), 'page-0', file('a')))).toBe(true);
  });

  it('round-trips page and round attachments through the stored projection', () => {
    let draft = addPageAttachment(emptyDraft('round-1'), 'page-0', file('a'));
    draft = addRoundAttachment(draft, file('b'));
    const restored = restoreDraft('round-1', toStoredDraft(draft, 'now'));
    expect(pageAttachments(restored, 'page-0')).toEqual([file('a')]);
    expect(restored.roundAttachments).toEqual([file('b')]);
  });

  it('copies attachments instead of aliasing the draft they came from', () => {
    const draft = addRoundAttachment(emptyDraft('round-1'), file('a'));
    const projection = toStoredDraft(draft, 'now');
    projection.roundAttachments![0]!.name = 'changed';
    expect(draft.roundAttachments[0]!.name).toBe('a.txt');
  });
});

describe('a reply naming its attachments', () => {
  it('names a page file inside that question block', () => {
    const text = formatAnswers(round([choice, free]), { 'page-0': { choices: ['Local'], text: '', other: '', notes: '' }, 'page-1': { choices: [], text: 'Because.', other: '', notes: '' } }, '', { 'page-1': [{ name: 'spec.pdf' }] });
    const blocks = text.split('### ');
    expect(blocks[1]).not.toContain('spec.pdf');
    expect(blocks[2]).toContain('Attached files: spec.pdf');
  });

  it('names round files in the additional context block', () => {
    const text = formatAnswers(round([choice]), { 'page-0': { choices: ['Local'], text: '', other: '', notes: '' } }, '', {}, [{ name: 'bundle.zip' }]);
    expect(text).toContain('## Additional context');
    expect(text).toContain('Attached files: bundle.zip');
  });

  it('keeps a text-only reply unchanged', () => {
    const text = formatAnswers(round([choice]), { 'page-0': { choices: ['Local'], text: '', other: '', notes: '' } });
    expect(text).not.toContain('Attached files');
    expect(text).not.toContain('## Additional context');
  });

  it('still refuses an incomplete answer when files are attached', () => {
    expect(() => formatAnswers(round([choice]), { 'page-0': { choices: [], text: '', other: '', notes: '' } }, '', { 'page-0': [{ name: 'a.txt' }] })).toThrow(/valid answer/);
  });

  it('delivers files in the order they were attached, across slides', () => {
    let draft = emptyDraft('round-1');
    draft = addRoundAttachment(draft, file('round-first'));
    draft = addPageAttachment(draft, 'page-0', file('page-second'));
    draft = addRoundAttachment(draft, file('round-third'));
    expect(orderedAttachments(draft).map(value => value.id)).toEqual(['round-first', 'page-second', 'round-third']);
  });

  it('keeps the attachment order across a stored round trip', () => {
    let draft = addRoundAttachment(emptyDraft('round-1'), file('a'));
    draft = addPageAttachment(draft, 'page-0', file('b'));
    const restored = restoreDraft('round-1', toStoredDraft(draft, 'now'));
    expect(orderedAttachments(restored).map(value => value.id)).toEqual(['a', 'b']);
  });

  it('drops a removed file from the order', () => {
    let draft = addRoundAttachment(addRoundAttachment(emptyDraft('round-1'), file('a')), file('b'));
    draft = removeRoundAttachment(draft, 'a');
    expect(orderedAttachments(draft).map(value => value.id)).toEqual(['b']);
  });

  it('orders a record written before the order existed by its collection order', () => {
    const legacy = { answers: {}, generalNotes: '', pageAttachments: { 'page-0': [file('p')] }, roundAttachments: [file('r')], active: null };
    expect(orderedAttachments(restoreDraft('round-1', legacy)).map(value => value.id)).toEqual(['p', 'r']);
  });
});
