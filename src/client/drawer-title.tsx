import React from 'react';

/** The header title: one ellipsized line with the project beside it. */
export function DrawerTitle({ id, title, projectName }: { id: string; title: string; projectName: string }) {
  return <div className="kb-drawer-title">
    <h2 id={id} title={title}>{title}</h2>
    <span className="kb-drawer-project" title={projectName}>{projectName}</span>
  </div>;
}
