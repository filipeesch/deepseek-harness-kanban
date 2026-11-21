# Spec Delta

## MODIFIED Requirements

### Requirement: File answers on a question round

A question slide SHALL accept files attached to that question, and the round's Additional Notes slide
SHALL accept files attached to the round as a whole. Files SHALL be accepted through the browser's
file input and by pasting a file from the clipboard.

Every attached file SHALL be stored as a generic file attachment. The plugin SHALL NOT decode an
image's dimensions, SHALL NOT produce a thumbnail, and SHALL NOT send an attached image as an image
part.

The round's attach control SHALL be one compact icon action in the question panel's footer, beside the
round's navigation actions. The action SHALL attach to the slide currently shown: a question slide
attaches to that question, and the Additional Notes slide attaches to the round. The footer SHALL list
the active slide's files as compact tokens, each carrying its display name and byte length, and each
token SHALL be removable before submission. The files of another slide SHALL NOT be listed while a
different slide is shown.

An attached file SHALL NOT by itself satisfy or invalidate that question's answer, and a round SHALL
remain submittable on the same conditions it had before files could be attached. A selection that
failed SHALL keep the round unsubmittable until it is retried or discarded, and the failure SHALL be
reported with a retry action and a discard action.

The attach action SHALL be reachable in every conversation that presents the round, including an
ordinary DSH chat whose conversation has no task card. Attaching a file SHALL NOT require a task.

#### Scenario: Attach a file to one question

- **WHEN** the user attaches a file through the footer action while a question slide is shown
- **THEN** that question owns the file, presented as a token in the footer with its display name and byte length
- **AND** the other question slides are unaffected

#### Scenario: Attach a file to the round

- **WHEN** the user attaches a file while the Additional Notes slide is shown
- **THEN** the file is attached to the round as a whole
- **AND** it is listed in the footer on that slide

#### Scenario: The action follows the active slide

- **WHEN** the user attaches a file on one question slide, moves to another question slide, and attaches another file
- **THEN** each file belongs to the question that was shown when it was attached
- **AND** each slide's footer lists only its own files

#### Scenario: Paste a file into a question

- **WHEN** the user pastes a file from the clipboard while a question slide is active
- **THEN** the file is attached to that question
- **AND** pasted text is not treated as a file

#### Scenario: Remove an attachment before submitting

- **WHEN** the user removes a token from the footer
- **THEN** the file no longer belongs to that slide
- **AND** the round's submittability is unchanged

#### Scenario: Files do not change answer validity

- **WHEN** the user attaches files to a question without answering it
- **THEN** that question remains unanswered
- **AND** Submit remains unavailable on the same condition as before

#### Scenario: A failed selection keeps the round unsubmittable

- **WHEN** a selected file cannot be attached
- **THEN** the panel reports the failure with a retry action and a discard action
- **AND** Submit stays unavailable until the selection is retried or discarded
- **AND** discarding the selection lets the round be submitted without that file

#### Scenario: Attach a file in a chat without a task

- **WHEN** the user attaches a file to a question round presented in an ordinary DSH chat
- **THEN** the file can be attached through the browser and the clipboard
- **AND** no task card is required

#### Scenario: Store an attached image as a generic file

- **WHEN** the user attaches a file whose content is an image
- **THEN** it is delivered as a generic file attachment
- **AND** no thumbnail is produced for it
