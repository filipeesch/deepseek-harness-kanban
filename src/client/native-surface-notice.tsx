/**
 * The one notice a surface shows when the running host cannot provide the
 * native surface it needs. The rail intentionally has none: its absence keeps
 * today's drawer behavior instead of offering an update diagnostic.
 */
import React, { type ReactNode } from 'react';

/**
 * Render one unsupported-native-surface notice.
 * @param props - title and the explanation, rendered as the alert body.
 * @returns the notice the drawer presents in place of the surface.
 */
export function NativeSurfaceNotice({ title, children }: { readonly title: string; readonly children: ReactNode }): React.JSX.Element {
  return <div className="kanban-native-state" role="alert">
    <strong>{title}</strong>
    {children}
  </div>;
}
