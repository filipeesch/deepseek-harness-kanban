import React from 'react';

/**
 * The one way a validation problem is presented next to its field.
 *
 * Every field in the editor reports through this component, so the same problem
 * cannot read as a hint in one tab and an alert in another.
 */
export function ProblemNotice({ message }: { readonly message?: string }) {
  if (message === undefined) return null;
  return <p className="kb-hint kb-problem" role="alert">{message}</p>;
}
