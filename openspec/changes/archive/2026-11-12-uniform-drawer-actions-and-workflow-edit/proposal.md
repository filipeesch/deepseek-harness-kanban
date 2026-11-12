# Proposal

## Why

The task drawer header uses visibly inconsistent icon sizes, control dimensions, and spacing. In the workflow diagram, a disabled stage-edit icon remains visible even though editing requires unlocking the layout.

## What Changes

- Harmonize the task drawer header action icons, alignment, and spacing while preserving the Auto chip label, states, actions, and responsive layout. The embedded native conversation header is out of scope.
- Hide the diagram stage-edit action while layout editing is locked, and show it when unlocked. Keep stage editing available in the column board.
- Align the affected specifications and tests, including contradictory locked-state scenarios, with the new behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: Consistent task drawer header action geometry without losing existing behavior or accessibility.
- `stage-editing`: Hide the diagram stage-edit action while locked, without changing the column board action.
- `workflow-view`: Reflect the diagram stage-edit action visibility and its interaction with layout locking.

## Impact

The plugin-owned drawer header styles and action components, shared stage header and workflow diagram adapter, existing client and browser tests, and the named specifications are affected. No host API, persistence format, or new dependency is needed.
