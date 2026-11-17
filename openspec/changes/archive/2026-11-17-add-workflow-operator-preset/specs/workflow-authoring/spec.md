# Spec Delta

## ADDED Requirements

### Requirement: Workflow descriptions remain concise authored context

Workflow and stage descriptions SHALL be optional author-supplied context, distinct from stage entry instructions. The workflow architect's guidance SHALL direct it to provide and maintain a description of at most 150 characters for the workflow and for every stage when designing or editing them, within the scope of the user's explicit authorization. This length is an instruction to the architect, not a validation limit imposed on other authors. Missing descriptions SHALL remain missing, and unrelated edits SHALL preserve existing descriptions and authored YAML. The architect SHALL retain access to the exact document and Hub revision through its existing gated read tools. The architect-only document read SHALL also identify the effective board default preset and the source of that choice, including a default held outside the authored YAML, without altering the exact document or its digest.

#### Scenario: Describe a workflow being designed

- **WHEN** the architect is authorized to design a workflow and its stages
- **THEN** its guidance directs it to write and maintain a concise description of at most 150 characters for each
- **AND** the description is not treated as an entry instruction

#### Scenario: Preserve an existing long description

- **WHEN** another author supplies a description longer than 150 characters or a legacy workflow already contains one
- **THEN** the length alone does not make the workflow invalid
- **AND** an unrelated edit does not silently truncate or rewrite it

#### Scenario: Leave an absent description truthful

- **WHEN** a legacy workflow or stage has no description
- **THEN** it remains valid and no description is invented on read
