import React, { type ReactNode } from 'react';
import type { Attention } from '../shared/types.js';
import { IconTabs, type IconTabItem } from './ui.js';
import type { DrawerSection } from './page-state.js';
import { ActivityDot, sectionTabName } from './activity-dot.js';
import { GitBranchIcon, HistoryIcon, InfoIcon, MessageIcon, NoteIcon } from './icons.js';

/** The section navigation entries that carry the activity facts. */
function sectionIcon(section: DrawerSection): ReactNode {
  switch (section) {
    case 'Conversations': return <MessageIcon size={17} />;
    case 'Info': return <InfoIcon size={17} />;
    case 'Git': return <GitBranchIcon size={17} />;
    case 'Notes': return <NoteIcon size={17} />;
    case 'History': return <HistoryIcon size={17} />;
    default: { const exhaustive: never = section; return exhaustive; }
  }
}

export interface DrawerSectionNavProps {
  id: string;
  sections: readonly DrawerSection[];
  selected: DrawerSection;
  onSelect: (section: DrawerSection) => void;
  activity: Pick<Attention, 'running' | 'background'>;
}

/** Icon-only section tabs; the Conversations tab also carries the activity dot. */
export function DrawerSectionNav({ id, sections, selected, onSelect, activity }: DrawerSectionNavProps) {
  const items: IconTabItem[] = sections.map(section => section === 'Conversations'
    ? {
      id: section,
      label: section,
      icon: sectionIcon(section),
      accessibleName: sectionTabName(section, activity),
      tooltip: sectionTabName(section, activity),
      badge: <ActivityDot running={activity.running} background={activity.background} />,
    }
    : { id: section, label: section, icon: sectionIcon(section) });
  return <IconTabs label="Task sections" items={items} selected={selected} onSelect={value => onSelect(value as DrawerSection)} id={id} />;
}
