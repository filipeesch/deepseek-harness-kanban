import React from 'react';
import { DrawerTitle } from './drawer-title.js';
import { DrawerSectionNav, type DrawerSectionNavProps } from './drawer-section-nav.js';
import { DrawerStageControl, type DrawerStageControlProps } from './drawer-stage-control.js';
import { DrawerActions, type DrawerActionsProps } from './drawer-actions.js';

export interface DrawerHeaderProps {
  title: { id: string; title: string; projectName: string };
  sectionNav: DrawerSectionNavProps;
  stage: DrawerStageControlProps;
  actions: DrawerActionsProps;
}

/**
 * The drawer's compact header: sections, title with project, stage control,
 * and the header actions. The layout wraps through the drawer-width container
 * query in drawer-header-styles, so the parts never branch on a viewport.
 */
export function DrawerHeader({ title, sectionNav, stage, actions }: DrawerHeaderProps) {
  return <header className="kb-drawer-header">
    <DrawerSectionNav {...sectionNav} />
    <DrawerTitle {...title} />
    <DrawerStageControl {...stage} />
    <DrawerActions {...actions} />
  </header>;
}
