import React, { type ComponentType } from 'react';
import {
  ArrowLeft as ArrowLeftGlyph,
  ChevronRight as ChevronRightGlyph,
  ChevronsRight as ChevronsRightGlyph,
  Clock as ClockGlyph,
  Cloud as CloudGlyph,
  Filter as FilterGlyph,
  FilterX as FilterClearGlyph,
  Folder as FolderGlyph,
  Frame as FrameGlyph,
  GitBranch as GitBranchGlyph,
  HardDrive as HardDriveGlyph,
  Info as InfoGlyph,
  LayoutGrid as LayoutGridGlyph,
  Lock as LockGlyph,
  LockOpen as LockOpenGlyph,
  Magnet as MagnetGlyph,
  MessagesSquare as MessagesSquareGlyph,
  NotebookPen as NotebookPenGlyph,
  Pencil as PencilGlyph,
  Play as PlayGlyph,
  Plus as PlusGlyph,
  Redo2 as Redo2Glyph,
  RotateCcw as RotateCcwGlyph,
  Search as SearchGlyph,
  Settings as SettingsGlyph,
  SquareCheck as SquareCheckGlyph,
  Trash as TrashGlyph,
  TriangleExclamationPoint as TriangleExclamationPointGlyph,
  Undo2 as Undo2Glyph,
  X as XGlyph,
  ZoomIn as ZoomInGlyph,
  ZoomOut as ZoomOutGlyph,
  type LucideProps,
} from 'lucide-react';

/** The plugin's stable icon contract; the glyph set behind it is replaceable. */
export type IconProps = { size?: number; className?: string };

const DEFAULT_SIZE = 16;
const STROKE_WIDTH = 2;

type Glyph = ComponentType<LucideProps>;

/**
 * Wrap one library glyph with the plugin's size, stroke, and accessibility defaults.
 * Callers keep using the plugin's own names, so swapping the icon library stays local.
 */
function icon(Glyph: Glyph, fill?: string) {
  return function Icon({ size = DEFAULT_SIZE, className }: IconProps) {
    return <Glyph size={size} strokeWidth={STROKE_WIDTH} className={className} aria-hidden="true" focusable={false} {...(fill === undefined ? {} : { fill })} />;
  };
}

export const SettingsIcon = icon(SettingsGlyph);
export const TrashIcon = icon(TrashGlyph);
export const PencilIcon = icon(PencilGlyph);
export const CloseIcon = icon(XGlyph);
export const PlusIcon = icon(PlusGlyph);
export const CheckSquareIcon = icon(SquareCheckGlyph);
export const FilterIcon = icon(FilterGlyph);
export const FilterClearIcon = icon(FilterClearGlyph);
export const InfoIcon = icon(InfoGlyph);
export const PlayIcon = icon(PlayGlyph, 'currentColor');
export const AlertIcon = icon(TriangleExclamationPointGlyph);
export const ClockIcon = icon(ClockGlyph);
export const ReopenIcon = icon(RotateCcwGlyph);
export const AutoModeIcon = icon(ChevronsRightGlyph);
export const GitBranchIcon = icon(GitBranchGlyph);
export const CloudIcon = icon(CloudGlyph);
export const DriveIcon = icon(HardDriveGlyph);
export const FolderIcon = icon(FolderGlyph);
export const ChevronRightIcon = icon(ChevronRightGlyph);
export const ArrowLeftIcon = icon(ArrowLeftGlyph);
export const SearchIcon = icon(SearchGlyph);

/** Conversations section navigation. */
export const MessageIcon = icon(MessagesSquareGlyph);
/** Notes section navigation. */
export const NoteIcon = icon(NotebookPenGlyph);
/** The header action that advances the task to the next workflow stage. */
export const AdvanceStageIcon = icon(ChevronsRightGlyph);

/** Diagram control stack. */
export const ZoomInIcon = icon(ZoomInGlyph);
export const ZoomOutIcon = icon(ZoomOutGlyph);
export const FitViewIcon = icon(FrameGlyph);
export const UndoIcon = icon(Undo2Glyph);
export const RedoIcon = icon(Redo2Glyph);
export const OrganizeIcon = icon(LayoutGridGlyph);
export const LockIcon = icon(LockGlyph);
export const UnlockIcon = icon(LockOpenGlyph);
export const MagnetIcon = icon(MagnetGlyph);
