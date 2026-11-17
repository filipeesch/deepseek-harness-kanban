import React, { useCallback, useState } from 'react';
import type { SessionArtifactLocation, SessionInspection, SessionObservation, SessionRepairResult } from '../shared/types.js';
import { classifySessionFailure, sessionObservationAdvice, sessionObservationLabel } from '../domain/session-observation.js';

/**
 * The Session fields the diagnosis reads. A Session that failed to open carries
 * the host's own failure, which is the same code the host-side classification uses.
 */
export interface SessionDiagnosisSession {
  readonly openState?: string;
  readonly openError?: { readonly code?: string; readonly message?: string } | null;
}

/** What the diagnosis may ask of the host. Both are read-only except `repair`. */
export interface SessionDiagnosisPort {
  /** Re-observe one Session and report its diagnosis with its artifact location. */
  inspect(sessionId: string): Promise<SessionInspection>;
  /** Repair a repeated PTC dispatch identifier; absent when the host cannot repair. */
  repair?(sessionId: string): Promise<SessionRepairResult>;
}

export interface SessionDiagnosisProps {
  sessionId: string;
  session: SessionDiagnosisSession | undefined;
  port: SessionDiagnosisPort | undefined;
}

/**
 * Styles stay scoped to the plugin's \`kbdx-\` classes and take every colour from the
 * host theme, so the strip follows light and dark appearance inside the native
 * conversation instead of depending on the board's style sheet.
 */
export const diagnosisCss = String.raw`
.kbdx{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;max-width:var(--dsh-composer-card-max-width,100%);margin:0 auto;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:8px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12.5px;overflow-wrap:anywhere}
.kbdx-head{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,currentColor)}
.kbdx-advice{margin:0}
.kbdx-details{margin:0}
.kbdx-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary,currentColor)}
.kbdx-rows{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 10px;margin:6px 0 0}
.kbdx-rows dt{color:var(--dsw-alias-label-secondary,currentColor)}
.kbdx-rows dd{margin:0;min-width:0}
.kbdx-rows code{font-size:11.5px;overflow-wrap:anywhere}
.kbdx-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.kbdx-button{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-base,transparent);color:inherit;cursor:pointer}
.kbdx-button:disabled{opacity:.6;cursor:default}
.kbdx-button[data-primary="true"]{border-color:var(--dsw-alias-state-error-primary,currentColor);color:var(--dsw-alias-state-error-primary,inherit)}
.kbdx-problem{margin:0;color:var(--dsw-alias-state-error-primary,inherit)}
`;

/** The one message a failed Session presents, rendered inside the native conversation. */
export function SessionDiagnosis({ sessionId, session, port }: SessionDiagnosisProps) {
  const [inspection, setInspection] = useState<SessionInspection | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'repair' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  /** Set once the host reports the repair applied, even if the follow-up read then fails. */
  const [repaired, setRepaired] = useState(false);
  const failure = classifySessionFailure(session?.openError);
  // A completed check is the truth; a repair success only stands in until one exists.
  // That way a log that becomes unreadable again returns to the diagnosis instead of
  // staying hidden behind a historical success.
  const inspected = inspection === null ? undefined : inspection.observation === null;
  const recovered = inspected === true || (repaired && inspected === undefined);

  const inspect = useCallback(async () => {
    if (port === undefined) return;
    setBusy('inspect');
    setProblem(null);
    try { setInspection(await port.inspect(sessionId)); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'The Session could not be checked.'); }
    finally { setBusy(null); }
  }, [port, sessionId]);

  const repair = useCallback(async () => {
    if (port?.repair === undefined) return;
    setBusy('repair');
    setProblem(null);
    let applied: SessionRepairResult;
    try { applied = await port.repair(sessionId); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'The Session could not be repaired.'); setBusy(null); return; }
    // The host applied the repair; a failing follow-up read must not present that as a
    // failed repair, so it is reported beside the recovery instead of replacing it.
    setBackupPath(applied.backupPath);
    setRepaired(true);
    setConfirming(false);
    try { setInspection(await port.inspect(sessionId)); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'The repaired Session could not be checked.'); }
    finally { setBusy(null); }
  }, [port, sessionId]);

  const copyPath = useCallback(async (location: SessionArtifactLocation) => {
    try {
      await navigator.clipboard.writeText(location.path);
      setCopied(true);
    } catch { setProblem('The log path could not be copied.'); }
  }, []);

  if (failure === null) return null;

  if (recovered) {
    return <div className="kbdx" role="status" data-state="recovered">
      <style>{diagnosisCss}</style>
      <span className="kbdx-head">Session log readable again</span>
      <p className="kbdx-advice">The stored log is valid now. Reopen this conversation to load it.</p>
      {backupPath !== null && <dl className="kbdx-rows"><dt>Backup</dt><dd><code>{backupPath}</code></dd></dl>}
      {problem !== null && <p className="kbdx-problem" role="alert">{problem}</p>}
      <div className="kbdx-actions">
        <button type="button" className="kbdx-button" disabled={busy !== null || port === undefined} onClick={() => { void inspect(); }}>Check the log again</button>
      </div>
    </div>;
  }

  const location = inspection?.location;
  return <div className="kbdx" role="alert" data-state={failure.state}>
    <style>{diagnosisCss}</style>
    <span className="kbdx-head">{sessionObservationLabel(failure.state)}</span>
    <p className="kbdx-advice">{sessionObservationAdvice(failure.state)}</p>
    <details className="kbdx-details" onToggle={event => { if ((event.target as HTMLDetailsElement).open && inspection === null) void inspect(); }}>
      <summary>Details</summary>
      <dl className="kbdx-rows">
        <dt>Cause</dt>
        <dd><code>{failure.cause}</code></dd>
        <dt>Session</dt>
        <dd><code>{sessionId}</code></dd>
        {location !== undefined && <><dt>Log</dt><dd><code>{location.path}</code></dd></>}
      </dl>
      {location !== undefined && <div className="kbdx-actions">
        <button type="button" className="kbdx-button" onClick={() => { void copyPath(location); }}>{copied ? 'Path copied' : 'Copy log path'}</button>
      </div>}
    </details>
    {problem !== null && <p className="kbdx-problem" role="status">{problem}</p>}
    <div className="kbdx-actions">
      <button type="button" className="kbdx-button" disabled={busy !== null || port === undefined} onClick={() => { void inspect(); }}>{busy === 'inspect' ? 'Checking…' : 'Recheck'}</button>
      {failure.state === 'unreadable' && port?.repair !== undefined && !confirming && <button type="button" className="kbdx-button" data-primary="true" disabled={busy !== null} onClick={() => setConfirming(true)}>Repair…</button>}
      {confirming && <>
        <p className="kbdx-advice">Renumbers only the repeated PTC dispatch identifiers, keeps the original as a backup, and changes nothing else.</p>
        <button type="button" className="kbdx-button" data-primary="true" disabled={busy !== null} onClick={() => { void repair(); }}>{busy === 'repair' ? 'Repairing…' : 'Repair this log'}</button>
        <button type="button" className="kbdx-button" disabled={busy !== null} onClick={() => setConfirming(false)}>Cancel</button>
      </>}
    </div>
  </div>;
}
