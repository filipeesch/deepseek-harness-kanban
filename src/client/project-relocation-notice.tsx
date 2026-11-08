import React from 'react';
import type { Project } from '../shared/types.js';

function detail(project: Project): string {
  return project.operation!.phase === 'waiting' ? 'Waiting for current work to finish.' : 'The relocation needs attention.';
}

/**
 * Compact board notice for a project relocation that is waiting or failed.
 * The Projects section remains the authoritative surface for progress and cancel.
 */
export function ProjectRelocationNotice({ projects, onRetry }: {
  projects: readonly Project[];
  onRetry: (projectId: string) => void;
}) {
  // Only the long-lived or actionable states belong on the board; transient steps stay in Projects.
  const entries = projects.filter(project => project.operation?.phase === 'waiting' || project.operation?.phase === 'failed');
  if (entries.length === 0) return null;
  return <section className="kb-destructive-notice" aria-label="Project relocation" role="region">
    {entries.map(project => {
      const operation = project.operation!;
      const failed = operation.phase === 'failed';
      return <div className={'kb-destructive-row' + (failed ? ' kb-destructive-row-failed' : '')} key={project.id}>
        <div>
          <strong>{failed ? 'Project relocation needs attention: ' : 'Project relocation: '}{project.name}</strong>
          <p className="kb-hint">{failed ? operation.error?.message ?? 'The relocation failed.' : detail(project)}</p>
        </div>
        {failed && <button type="button" className="kb-button" onClick={() => onRetry(project.id)}>Retry relocation — {project.name}</button>}
      </div>;
    })}
  </section>;
}
