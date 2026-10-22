const PLAN = Object.freeze({
  status: "prepared-not-executed",
  bundle: "dsh-kanban",
  nativeEffectsExecuted: 0,
  steps: [
    "Route ALL runner-owned public commands/snapshots through the server promise ledger and acknowledge exact delivery receipts.",
    "Pause runner admissions, drain actual promises, reject unknown outcomes, and require an exclusive operator window.",
    "Require own bundle originally enabled and ALL foreign pending operations/transitions zero before effects.",
    "Keep the independent guards and native-job controller outside the Kanban bundle.",
    "In ONE server async function await OFF, including every prelude and manager await.",
    "Only after applied/observed OFF permit ACTUAL owned producer settlement and collect canonical native job waits.",
    "In the SAME finally await ON after the own OFF await settles, including cancellation, rejection, restart-required and unknown outcomes.",
    "Never issue Kanban RPC while OFF. A client timeout never authorizes a competing client restore.",
    "Release runner admission only after confirmed applied ON; otherwise retain the fence for operator recovery after server completion."
  ],
  limitation: "Runner-owned calls only, not an atomic fence on external user clients. The exclusive operator window is an explicit environmental precondition."
});
const PINNED_SOURCE_ROOT = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/";
const PINNED_API_PROOF = Object.freeze([
  { file: "@deepseek-ai/dsh-plugin-manager/lib/index.js", lines: [1949, 1957], fact: "setBundleEnabled awaits selectBundle and reload/publication through change/configure." },
  { file: "@deepseek-ai/dsh-plugin-manager/lib/index.js", lines: [2324, 2330], fact: "HMR runExclusive orders only its own apply callback, not a client listBundles prelude." },
  { file: "@deepseek-ai/dsh-plugin-manager/lib/index.js", lines: [2373, 2400], fact: "change awaits its operation under withFileLock and reports applied/restart-required/cancelled/failed or override." },
  { file: "@deepseek-ai/dsh-atomic-write/lib/index.js", lines: [189, 217], fact: "The writer lock is released in finally after the awaited operation. A client prelude is outside this lock." },
  { file: "@deepseek-ai/dsh-jobs/lib/types/index.d.ts", lines: [71, 145], fact: "Owner-fenced get/wait are canonical; wait timeout does not cancel work." },
  { file: "@deepseek-ai/dsh-jobs/lib/types/view.d.ts", lines: [15, 93], fact: "Native statuses are running/stopping/completed/killed/failed, not operational receipt phases." }
]);
const INTEGRATION_CONTRACT = Object.freeze({
  version: "own-kanban-lifecycle-v1",
  gate: "Construct createRunnerKanbanGate.call(hostRoot) inside the SAME Host server realm. It binds only fresh public ctx.get(kanbanController).command/snapshot methods; no client-promise callback injection is accepted.",
  realm: "A non-serializable symbol brand binds the gate to the exact Host root object. This prevents accidental wrong-root/by-value injection, not universal realm attestation: same-server construction/Host object-reference transport remains an explicit reviewed integration assumption.",
  lifetime: "The gate, native guards and job controller must be rooted outside dsh-kanban and outlive its OFF, the server transaction and actual native resources.",
  outside: "Pass {gate,assertRetained(),settleOwnedWhileOff(permit)} as an existing server object, not client JSON booleans. All selected outer/inner jobs must already be registered and running, and new producer admission must be closed. Settlement must await the real approved producer and all inner resources; its return value cannot manufacture native status.",
  acceptance: "A successful transaction-window receipt is NOT a native journal-gate pass. Post-ON public verification of the persisted journal, native IDs/history and canonical contexts remains mandatory in the separately reviewed integration.",
  privacy: "Gate result/recovery values are private ordinary public-RPC data. Never include them in logs or lifecycle receipts; status exposes only counts and scoped canonical job facts.",
  transport: "Retain the server handle. start is single-use/idempotent. Client timeout/disconnect must not cancel the server promise or issue client-side ON. Unknown server completion is not a passed gate. Server-process death is outside this in-memory guarantee and requires operator recovery.",
  cancellation: "requestCancel changes operational intent only. It never edits native job status or aborts an in-flight manager call.",
  failure: "Unconfirmed ON keeps runner admission closed. Operator recovery must wait for server completion; do not automatically retry restore from the client.",
  scope: "No global SDK fence, monkeypatch, private app snapshot, synthetic job events, model requests, timer-based activity, or manual native status assignment."
});
function createRunnerKanbanGate() {
  if (arguments.length !== 0) throw new Error("HOST_GATE_CALLBACK_INJECTION_FORBIDDEN");
  const ctx = this?.root ?? this;
  if (!ctx || typeof ctx.get !== "function") throw new Error("HOST_SERVER_CONTEXT_REQUIRED");
  const invokers = { command: (request) => ctx.get("kanbanController").command(request), snapshot: () => ctx.get("kanbanController").snapshot() };
  const records = /* @__PURE__ */ new Map();
  let held, serial = 0;
  const fail = (code) => {
    throw new Error(code);
  };
  const id = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(value);
  const status = () => ({ scope: "runner-owned-only", admissionsPaused: !!held, inFlight: [...records.values()].filter((r) => !r.settled).length, unknownOutcomes: [...records.values()].filter((r) => r.settled && !r.acknowledged).length });
  const issue = (kind, callId, args, internal = false) => {
    if (!["command", "snapshot"].includes(kind) || !id(callId) || records.has(callId)) fail("RUNNER_CALL_INVALID");
    if (held && !internal) fail("RUNNER_ADMISSIONS_PAUSED");
    const row = { callId, kind, settled: false, acknowledged: internal, outcome: void 0, value: void 0, delivery: void 0 };
    records.set(callId, row);
    row.promise = Promise.resolve().then(() => invokers[kind](args)).then((value) => {
      row.outcome = "fulfilled";
      row.value = value;
    }, () => {
      row.outcome = "rejected";
    }).then(() => {
      row.settled = true;
    });
    return row;
  };
  const quiet = () => {
    const value = status();
    if (value.inFlight !== 0) fail("RUNNER_CALLS_IN_FLIGHT");
    if (value.unknownOutcomes !== 0) fail("RUNNER_OUTCOME_UNKNOWN");
  };
  return Object.freeze({
    [Symbol.for("dsh-kanban.uat.server-gate.v1")]: Object.freeze({ contract: "host-root-runner-gate-v1", root: ctx }),
    begin(kind, callId, args) {
      issue(kind, callId, args);
      return { callId, state: "pending" };
    },
    async result(callId) {
      const row = records.get(callId);
      if (!row) fail("RUNNER_CALL_UNKNOWN");
      await row.promise;
      row.delivery ??= "delivery-" + ++serial;
      return row.outcome === "fulfilled" ? { callId, delivery: row.delivery, outcome: "fulfilled", value: row.value } : { callId, delivery: row.delivery, outcome: "rejected", failure: "PUBLIC_CALL_REJECTED" };
    },
    acknowledge(callId, delivery) {
      const row = records.get(callId);
      if (!row?.settled || !row.delivery || row.delivery !== delivery) fail("RUNNER_RECEIPT_INVALID");
      row.acknowledged = true;
      return { callId, acknowledged: true };
    },
    status,
    async acquire(transactionId) {
      if (!id(transactionId) || held) fail("RUNNER_LEASE_BUSY");
      const token = { sealed: false, released: false };
      held = token;
      await Promise.all([...records.values()].map((row) => row.promise));
      const assertHeld = () => {
        if (held !== token || token.released) fail("RUNNER_LEASE_LOST");
        quiet();
      };
      return Object.freeze({
        status,
        assertHeld,
        async snapshotBeforeOff() {
          assertHeld();
          if (token.sealed) fail("KANBAN_READ_AFTER_OFF_SEAL");
          let key;
          do {
            key = "internal-" + ++serial;
          } while (records.has(key));
          const row = issue("snapshot", key, void 0, true);
          await row.promise;
          if (row.outcome !== "fulfilled") fail("PUBLIC_SNAPSHOT_REJECTED");
          return row.value;
        },
        seal() {
          assertHeld();
          token.sealed = true;
        },
        release() {
          if (held !== token || token.released) fail("RUNNER_LEASE_LOST");
          if (status().inFlight !== 0) fail("RUNNER_CALLS_IN_FLIGHT");
          token.released = true;
          held = void 0;
        }
      });
    }
  });
}
function installNativeLifecycleTransaction(options, outside) {
  const failure = (code) => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
  const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(value);
  const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!plain(options) || options.allowOwnerTest !== true || options.allowFixtureData !== true || options.allowNativeJobProducer !== true || options.allowPluginLifecycle !== true || options.exclusiveOperatorWindow !== true) failure("LIFECYCLE_NOT_AUTHORIZED");
  const keys = ["transactionId", "bundleName", "allowOwnerTest", "allowFixtureData", "allowNativeJobProducer", "allowPluginLifecycle", "exclusiveOperatorWindow", "fixture", "ownedTaskIds", "ownedSessionIds", "jobs"];
  if (Object.keys(options).some((key) => !keys.includes(key)) || options.bundleName !== "dsh-kanban" || !safeId(options.transactionId)) failure("LIFECYCLE_REQUEST_INVALID");
  let cfg;
  try {
    cfg = JSON.parse(JSON.stringify(options));
  } catch {
    failure("LIFECYCLE_REQUEST_INVALID");
  }
  const ids = (value) => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(safeId) && new Set(value).size === value.length;
  const path = (value) => typeof value === "string" && value.startsWith("/") && !value.includes("//") && value.split("/").every((part) => part !== "." && part !== "..") && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!ids(cfg.ownedTaskIds) || !ids(cfg.ownedSessionIds) || !plain(cfg.fixture) || Object.keys(cfg.fixture).some((key) => !["nonce", "run", "base"].includes(key)) || !/^[a-f0-9]{12}$/.test(cfg.fixture.nonce) || !path(cfg.fixture.run) || !path(cfg.fixture.base) || !cfg.fixture.run.endsWith("/run-" + cfg.fixture.nonce) || !cfg.fixture.run.includes("/.verification/native-fixtures/") || !cfg.fixture.base.startsWith(cfg.fixture.run + "/") || cfg.transactionId !== "g3-lifecycle-" + cfg.fixture.nonce) failure("LIFECYCLE_OWNERSHIP_INVALID");
  if (!Array.isArray(cfg.jobs) || cfg.jobs.length === 0 || cfg.jobs.length > 100 || new Set(cfg.jobs.map((job) => job?.id)).size !== cfg.jobs.length) failure("LIFECYCLE_JOBS_INVALID");
  for (const job of cfg.jobs) if (!plain(job) || Object.keys(job).some((key) => !["id", "owner", "kind", "label", "rootCallId"].includes(key)) || ![job.id, job.owner, job.kind, job.rootCallId].every(safeId) || !cfg.ownedSessionIds.includes(job.owner) || typeof job.label !== "string" || !job.label.length || job.label.length > 240 || [...job.label].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) failure("LIFECYCLE_JOBS_INVALID");
  if (!outside || typeof outside.gate?.acquire !== "function" || typeof outside.assertRetained !== "function" || typeof outside.settleOwnedWhileOff !== "function") failure("INDEPENDENT_CONTROLLER_REQUIRED");
  const ctx = this?.root ?? this;
  if (!ctx || typeof ctx.get !== "function") failure("PUBLIC_CAPABILITY_REQUIRED");
  const brand = outside.gate[Symbol.for("dsh-kanban.uat.server-gate.v1")];
  if (brand?.contract !== "host-root-runner-gate-v1" || brand.root !== ctx) failure("HOST_SERVER_GATE_REQUIRED");
  const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
  const exactKeys = (value, keys2) => plain(value) && Object.keys(value).every((key) => keys2.includes(key));
  const ownPath = (value) => path(value) && value.startsWith(cfg.fixture.run + "/");
  const initialRequest = (request, task, project) => {
    if (!plain(request)) return false;
    const kind = request.kind, tree = task.worktree;
    const target = kind === "create" || kind === "attach" ? request.path : tree?.path;
    if (target !== void 0 && (!ownPath(target) || target === project.gitRootPath || target === project.projectPath || project.gitRootPath.startsWith(target + "/") || project.projectPath.startsWith(target + "/"))) return false;
    if (kind === "create") return tree === null && ownPath(target) && exactKeys(request, ["kind", "mode", "path", "branchName", "sourceBranch"]) && ["new", "existing"].includes(request.mode) && nonempty(request.branchName) && (request.sourceBranch === void 0 || nonempty(request.sourceBranch));
    if (kind === "attach") return ownPath(target) && exactKeys(request, ["kind", "path"]) && (!tree || tree.path === target);
    if (kind === "return") return exactKeys(request, ["kind"]);
    if (kind === "remove" || kind === "delete") return exactKeys(request, ["kind", "discardChanges", "expectedWorktreePath"]) && typeof request.discardChanges === "boolean" && request.expectedWorktreePath === (target ?? null);
    return false;
  };
  const pristineOperation = (operation, task, project) => {
    if (!exactKeys(operation, ["id", "request", "phase", "targetPath", "targetDirectory", "previousDirectories", "switchedSessionIds", "archivedSessionIds", "gitCompleted", "error", "createdAt", "createAttempt"]) || !safeId(operation.id) || operation.phase !== "waiting" || !initialRequest(operation.request, task, project)) return false;
    if (operation.gitCompleted !== false || operation.createAttempt !== void 0 || operation.error !== void 0 || operation.targetDirectory !== void 0 || !plain(operation.previousDirectories) || Object.keys(operation.previousDirectories).length !== 0 || !Array.isArray(operation.switchedSessionIds) || operation.switchedSessionIds.length !== 0 || !Array.isArray(operation.archivedSessionIds) || operation.archivedSessionIds.length !== 0 || typeof operation.createdAt !== "string" || !Number.isFinite(Date.parse(operation.createdAt))) return false;
    const kind = operation.request.kind;
    return operation.targetPath === (kind === "create" || kind === "attach" ? operation.request.path : task.worktree?.path);
  };
  const pristineTransition = (transition, task, project) => {
    if (!exactKeys(transition, ["id", "fromColumnId", "columnId", "mode", "sessionId", "text", "worktreeRequest", "status", "error"]) || !safeId(transition.id) || !safeId(transition.columnId) || transition.fromColumnId !== task.columnId || !["move", "run"].includes(transition.mode) || transition.status !== "waiting" || transition.error !== void 0 || transition.text !== void 0 && typeof transition.text !== "string") return false;
    if (transition.sessionId !== void 0 && !task.sessionIds.includes(transition.sessionId) || transition.mode === "run" && !task.sessionIds.includes(transition.sessionId)) return false;
    if (transition.worktreeRequest !== void 0) {
      if (!exactKeys(transition.worktreeRequest, ["mode", "path", "branchName", "sourceBranch"])) return false;
      const requested = { ...transition.worktreeRequest, kind: "create" };
      if (!initialRequest(requested, task, project)) return false;
      if (task.operation && (task.operation.request.kind !== "create" || ["mode", "path", "branchName", "sourceBranch"].some((key) => task.operation.request[key] !== requested[key]))) return false;
    }
    return true;
  };
  const terminal = (value) => ["completed", "failed", "killed"].includes(value);
  const applications = ["applied", "restart-required", "overridden", "cancelled", "failed"];
  const state = { version: "own-kanban-lifecycle-v1", verificationScope: "transaction-window-only", nativeJournalGate: "not-verified", transactionId: cfg.transactionId, bundleName: "dsh-kanban", operational: { phase: "prepared", started: false, serverSettled: false, cancelRequested: false, originalEnabled: null, offAttempted: false, offSettled: false, offApplication: "not-attempted", offObserved: false, onAttempted: false, onSettled: false, onApplication: "not-attempted", restorationConfirmed: false, leaseRetained: false, workPermitted: false, workSettled: false }, quiescence: { scope: "runner-owned-only", externalClientsAtomicallyFenced: false, exclusiveOperatorWindow: true, foreignPendingOperations: null, foreignPendingTransitions: null, inFlightRunnerCalls: null, unknownRunnerOutcomes: null }, nativeJobs: [], errors: [], ok: false };
  let promise, lease, unsub, offConfirmed = false, disposed = false;
  const views = /* @__PURE__ */ new Map(), waits = /* @__PURE__ */ new Map(), settledEvents = /* @__PURE__ */ new Map();
  const addError = (code) => {
    if (!state.errors.includes(code)) state.errors.push(code);
  };
  const receipt = () => JSON.parse(JSON.stringify(state));
  const cancelled = () => {
    if (state.operational.cancelRequested) failure("LIFECYCLE_CANCELLED");
  };
  const application = (value, enabled) => plain(value) && value.stage === "enable" && value.target === "dsh-kanban" && value.enabled === enabled && typeof value.changed === "boolean" && applications.includes(value.application) ? value.application : "unknown";
  const bundle = async (manager) => {
    const rows = await manager.listBundles();
    if (!Array.isArray(rows)) failure("BUNDLE_LIST_UNVERIFIED");
    const own = rows.filter((row) => row?.name === "dsh-kanban");
    if (own.length !== 1 || typeof own[0].enabled !== "boolean" || own[0].error || own[0].readOnlyReason) failure("OWN_BUNDLE_UNAVAILABLE");
    return own[0];
  };
  const canonical = (jobs, spec) => {
    const view = jobs.get(spec.id, spec.owner);
    if (!view || view.id !== spec.id || view.owner !== spec.owner || view.kind !== spec.kind || view.label !== spec.label || !["running", "stopping", "completed", "failed", "killed"].includes(view.status) || !Number.isFinite(view.startedAt)) failure("CANONICAL_JOB_IDENTITY_UNVERIFIED");
    const before = views.get(spec.id);
    if (before && before.startedAt !== view.startedAt) failure("CANONICAL_JOB_IDENTITY_CHANGED");
    views.set(spec.id, { id: view.id, owner: view.owner, kind: view.kind, label: view.label, startedAt: view.startedAt, status: view.status });
    return view;
  };
  const exactSettledEvent = (view) => {
    if (!view) return false;
    const observed = settledEvents.get(view.id);
    return observed?.awaited === true && observed.id === view.id && observed.owner === view.owner && observed.kind === view.kind && observed.label === view.label && observed.startedAt === view.startedAt && observed.status === view.status;
  };
  const nativeReceipt = () => {
    state.nativeJobs = cfg.jobs.filter((spec) => views.has(spec.id)).map((spec) => ({ jobId: views.get(spec.id).id, owner: views.get(spec.id).owner, nativeStatus: views.get(spec.id).status, waitObserved: waits.get(spec.id)?.observed === true, settledEventObserved: exactSettledEvent(views.get(spec.id)) }));
  };
  async function run() {
    let manager, jobs;
    state.operational.started = true;
    state.operational.phase = "preflight";
    try {
      cancelled();
      manager = ctx.get("pluginManager");
      jobs = ctx.get("jobs");
      const fs = ctx.get("fs"), sessions = ctx.get("sessionController");
      if (!manager || typeof manager.listBundles !== "function" || typeof manager.setBundleEnabled !== "function" || !jobs || ["get", "list", "wait"].some((key) => typeof jobs[key] !== "function") || typeof jobs.events?.subscribe !== "function" || !fs || ["resolve", "processPath", "contains", "stat"].some((key) => typeof fs[key] !== "function") || typeof sessions?.inspect !== "function") failure("PUBLIC_CAPABILITY_REQUIRED");
      lease = await outside.gate.acquire(cfg.transactionId);
      state.operational.leaseRetained = true;
      const quiet = lease.status();
      state.quiescence.inFlightRunnerCalls = quiet.inFlight;
      state.quiescence.unknownRunnerOutcomes = quiet.unknownOutcomes;
      lease.assertHeld();
      if (quiet.scope !== "runner-owned-only" || quiet.admissionsPaused !== true || quiet.inFlight !== 0 || quiet.unknownOutcomes !== 0) failure("RUNNER_QUIESCENCE_UNVERIFIED");
      const original = await bundle(manager);
      state.operational.originalEnabled = original.enabled;
      if (original.enabled !== true) failure("OWN_BUNDLE_NOT_ENABLED");
      const board = await lease.snapshotBeforeOff();
      if (!plain(board) || board.ok !== true || !Array.isArray(board.value?.state?.tasks) || !Array.isArray(board.value?.state?.projects)) failure("PUBLIC_SNAPSHOT_UNVERIFIED");
      const tasks = board.value.state.tasks, ownTasks = new Set(cfg.ownedTaskIds);
      if (cfg.ownedTaskIds.some((id) => tasks.filter((task) => task.id === id).length !== 1)) failure("OWN_TASK_IDENTITY_UNVERIFIED");
      state.quiescence.foreignPendingOperations = tasks.filter((task) => !ownTasks.has(task.id) && task.operation != null).length;
      state.quiescence.foreignPendingTransitions = tasks.filter((task) => !ownTasks.has(task.id) && task.pendingTransition != null).length;
      if (state.quiescence.foreignPendingOperations || state.quiescence.foreignPendingTransitions) failure("FOREIGN_PENDING_WORK");
      if (!tasks.some((task) => ownTasks.has(task.id) && (task.operation?.phase === "waiting" || task.pendingTransition?.status === "waiting"))) failure("OWN_WAITING_JOURNAL_REQUIRED");
      for (const task of tasks.filter((task2) => ownTasks.has(task2.id))) {
        if (task.operation != null && task.operation.phase !== "waiting" || task.pendingTransition != null && task.pendingTransition.status !== "waiting") failure("OWN_JOURNAL_NOT_QUIET");
        const project = board.value.state.projects.find((project2) => project2.id === task.projectId);
        if (project?.projectPath !== cfg.fixture.base || !ownPath(project.gitRootPath) || !(cfg.fixture.base === project.gitRootPath || cfg.fixture.base.startsWith(project.gitRootPath + "/")) || !ids(task.sessionIds) || task.sessionIds.some((id) => !cfg.ownedSessionIds.includes(id))) failure("OWN_TASK_IDENTITY_UNVERIFIED");
        if (task.effectiveCwd !== cfg.fixture.base || !Array.isArray(task.closedSessionIds) || new Set(task.closedSessionIds).size !== task.closedSessionIds.length || task.closedSessionIds.some((id) => !task.sessionIds.includes(id)) || task.worktree !== null && (!plain(task.worktree) || !ownPath(task.worktree.path) || !nonempty(task.worktree.branch) || typeof task.worktree.owned !== "boolean" || !["ready", "error"].includes(task.worktree.status))) failure("OWN_TASK_CONTEXT_UNVERIFIED");
        if (task.operation != null && !pristineOperation(task.operation, task, project) || task.pendingTransition != null && !pristineTransition(task.pendingTransition, task, project)) failure("OWN_WAITING_CONTEXT_UNVERIFIED");
      }
      const runPath = await fs.resolve(cfg.fixture.run), basePath = await fs.resolve(cfg.fixture.base);
      if (fs.processPath(runPath) !== cfg.fixture.run || fs.processPath(basePath) !== cfg.fixture.base || !fs.contains(runPath, basePath) || (await fs.stat(runPath))?.type !== "directory" || (await fs.stat(basePath))?.type !== "directory") failure("FIXTURE_CANONICAL_PATH_UNVERIFIED");
      for (const owner of cfg.ownedSessionIds) {
        const snapshot = await sessions.inspect(owner);
        if (snapshot.meta?.cwd !== cfg.fixture.base || !Array.isArray(snapshot.events)) failure("OWN_SESSION_ORIGIN_UNVERIFIED");
        let current = snapshot.meta.cwd;
        for (const event of snapshot.events) if (event.type === "working-directory/change") current = event.data?.cwd;
        if (current !== cfg.fixture.base) failure("OWN_SESSION_CONTEXT_UNVERIFIED");
        for (const spec of cfg.jobs.filter((spec2) => spec2.owner === owner)) {
          const registered = snapshot.events.filter((event) => event.type === "job/registered" && event.data?.jobId === spec.id);
          if (registered.length !== 1 || registered[0].data.owner !== owner || registered[0].data.kind !== spec.kind || registered[0].data.label !== spec.label || registered[0].data.toolCall?.rootCallId !== spec.rootCallId) failure("NATIVE_JOB_REGISTRATION_UNVERIFIED");
        }
      }
      const expected = new Map(cfg.jobs.map((spec) => [spec.id, spec]));
      for (const owner of cfg.ownedSessionIds) if (jobs.list(owner).some((view) => view.owner === owner && !terminal(view.status) && !expected.has(view.id))) failure("UNEXPECTED_OWNED_ACTIVITY");
      await outside.assertRetained();
      unsub = jobs.events.subscribe({ owners: "all" }, (event) => {
        if (state.operational.serverSettled) return;
        const spec = expected.get(event.job?.id);
        if (!spec) {
          if (event.type === "registered" && cfg.ownedSessionIds.includes(event.job?.owner)) addError("OWN_NATIVE_JOB_SET_CHANGED");
          return;
        }
        if (event.job.owner !== spec.owner) {
          addError("CANONICAL_JOB_IDENTITY_CHANGED");
          return;
        }
        if (event.type === "settled") {
          if (!offConfirmed) addError("NATIVE_JOB_SETTLED_BEFORE_PERMISSION");
          if (event.awaited !== true) addError("NATIVE_JOB_UNAWAITED");
          const registered = views.get(spec.id);
          if (!registered || event.awaited !== true || event.job.kind !== spec.kind || event.job.label !== spec.label || event.job.startedAt !== registered.startedAt || !terminal(event.job.status)) {
            addError("NATIVE_SETTLED_EVENT_UNVERIFIED");
            return;
          }
          if (settledEvents.has(spec.id)) {
            addError("NATIVE_SETTLED_EVENT_DUPLICATE");
            return;
          }
          settledEvents.set(spec.id, { id: event.job.id, owner: event.job.owner, kind: event.job.kind, label: event.job.label, startedAt: event.job.startedAt, status: event.job.status, awaited: true });
        }
      });
      for (const spec of cfg.jobs) {
        if (canonical(jobs, spec).status !== "running") failure("NATIVE_JOB_NOT_RUNNING");
        const row = { observed: false, value: void 0, failure: false };
        waits.set(spec.id, row);
        row.promise = Promise.resolve(jobs.wait(spec.id, 12e4, spec.owner)).then((value) => {
          if (state.operational.serverSettled) return;
          row.observed = true;
          row.value = value;
        }, () => {
          if (!state.operational.serverSettled) row.failure = true;
        });
      }
      lease.seal();
      lease.assertHeld();
      cancelled();
      const immediatelyBeforeOff = await bundle(manager);
      cancelled();
      if (immediatelyBeforeOff.enabled !== true) failure("OWN_BUNDLE_CHANGED_BEFORE_OFF");
      if (state.errors.length) failure(state.errors[0]);
      state.operational.phase = "disabling";
      state.operational.offAttempted = true;
      state.operational.offApplication = "unknown";
      let off;
      try {
        off = await manager.setBundleEnabled("dsh-kanban", false);
      } catch {
        failure("OFF_CALL_REJECTED");
      } finally {
        state.operational.offSettled = true;
      }
      state.operational.offApplication = application(off, false);
      if (state.operational.offApplication !== "applied") failure("OFF_NOT_APPLIED");
      if ((await bundle(manager)).enabled !== false) failure("OFF_STATE_UNCONFIRMED");
      state.operational.offObserved = true;
      state.operational.phase = "disabled";
      offConfirmed = true;
      await outside.assertRetained();
      cancelled();
      for (const spec of cfg.jobs) if (canonical(jobs, spec).status !== "running") failure("NATIVE_JOB_SETTLED_BEFORE_PERMISSION");
      if (state.errors.length) failure(state.errors[0]);
      state.operational.phase = "settling-owned-work";
      state.operational.workPermitted = true;
      try {
        await outside.settleOwnedWhileOff(Object.freeze({ transactionId: cfg.transactionId, bundleName: "dsh-kanban", jobIds: Object.freeze(cfg.jobs.map((spec) => spec.id)), ownerIds: Object.freeze([...cfg.ownedSessionIds]) }));
      } catch {
        failure("OWN_NATIVE_WORK_REJECTED");
      }
      state.operational.workSettled = true;
      await Promise.all([...waits.values()].map((row) => row.promise));
      for (const spec of cfg.jobs) {
        const row = waits.get(spec.id);
        if (row.failure || !row.observed || row.value?.id !== spec.id || row.value.owner !== spec.owner || row.value.kind !== spec.kind || row.value.label !== spec.label || row.value.startedAt !== views.get(spec.id)?.startedAt || !terminal(row.value.status)) failure("CANONICAL_JOB_WAIT_UNVERIFIED");
        const view = canonical(jobs, spec);
        if (view.status !== row.value.status || !terminal(view.status)) failure("CANONICAL_JOB_STATUS_UNVERIFIED");
        const observed = settledEvents.get(spec.id);
        if (!observed) failure("NATIVE_SETTLED_EVENT_UNVERIFIED");
        if (!exactSettledEvent(view)) failure("NATIVE_SETTLED_EVENT_INCONSISTENT");
        if (view.status !== "completed") addError("OWN_NATIVE_JOB_UNSUCCESSFUL");
      }
      for (const owner of cfg.ownedSessionIds) if (jobs.list(owner).some((view) => view.owner === owner && !terminal(view.status))) failure("OWN_NATIVE_ACTIVITY_REMAINS");
      await outside.assertRetained();
      cancelled();
    } catch (cause) {
      const codes = ["LIFECYCLE_CANCELLED", "PUBLIC_CAPABILITY_REQUIRED", "RUNNER_QUIESCENCE_UNVERIFIED", "RUNNER_CALLS_IN_FLIGHT", "RUNNER_OUTCOME_UNKNOWN", "RUNNER_LEASE_LOST", "PUBLIC_SNAPSHOT_REJECTED", "BUNDLE_LIST_UNVERIFIED", "OWN_BUNDLE_UNAVAILABLE", "OWN_BUNDLE_NOT_ENABLED", "PUBLIC_SNAPSHOT_UNVERIFIED", "OWN_TASK_IDENTITY_UNVERIFIED", "OWN_TASK_CONTEXT_UNVERIFIED", "OWN_WAITING_CONTEXT_UNVERIFIED", "FOREIGN_PENDING_WORK", "OWN_WAITING_JOURNAL_REQUIRED", "OWN_JOURNAL_NOT_QUIET", "FIXTURE_CANONICAL_PATH_UNVERIFIED", "OWN_SESSION_ORIGIN_UNVERIFIED", "OWN_SESSION_CONTEXT_UNVERIFIED", "NATIVE_JOB_REGISTRATION_UNVERIFIED", "UNEXPECTED_OWNED_ACTIVITY", "CANONICAL_JOB_IDENTITY_UNVERIFIED", "CANONICAL_JOB_IDENTITY_CHANGED", "NATIVE_JOB_NOT_RUNNING", "OWN_BUNDLE_CHANGED_BEFORE_OFF", "OFF_CALL_REJECTED", "OFF_NOT_APPLIED", "OFF_STATE_UNCONFIRMED", "NATIVE_JOB_SETTLED_BEFORE_PERMISSION", "NATIVE_JOB_UNAWAITED", "OWN_NATIVE_WORK_REJECTED", "CANONICAL_JOB_WAIT_UNVERIFIED", "CANONICAL_JOB_STATUS_UNVERIFIED", "NATIVE_SETTLED_EVENT_UNVERIFIED", "NATIVE_SETTLED_EVENT_INCONSISTENT", "OWN_NATIVE_ACTIVITY_REMAINS"];
      addError(codes.includes(cause?.code) ? cause.code : codes.includes(cause?.message) ? cause.message : "LIFECYCLE_PRECONDITION_OR_WORK_FAILED");
    } finally {
      if (state.operational.offAttempted) {
        offConfirmed = false;
        state.operational.phase = "restoring";
        state.operational.onAttempted = true;
        state.operational.onApplication = "unknown";
        try {
          const on = await manager.setBundleEnabled("dsh-kanban", true);
          state.operational.onSettled = true;
          state.operational.onApplication = application(on, true);
          if (state.operational.onApplication !== "applied") addError("ON_NOT_APPLIED");
          else if ((await bundle(manager)).enabled === true) state.operational.restorationConfirmed = true;
          else addError("ON_STATE_UNCONFIRMED");
        } catch {
          state.operational.onSettled = true;
          addError("ON_CALL_OR_OBSERVATION_REJECTED");
        }
      }
      if (lease && (!state.operational.offAttempted || state.operational.restorationConfirmed)) {
        try {
          await lease.release();
          state.operational.leaseRetained = false;
        } catch {
          addError("RUNNER_LEASE_RELEASE_FAILED");
        }
      }
      if (unsub) try {
        unsub();
      } catch {
        addError("JOB_OBSERVER_RELEASE_FAILED");
      }
      nativeReceipt();
      state.operational.phase = "complete";
      state.operational.serverSettled = true;
      state.ok = state.errors.length === 0 && state.operational.originalEnabled === true && state.operational.offObserved && state.operational.workSettled && state.operational.restorationConfirmed && state.nativeJobs.length === cfg.jobs.length && state.nativeJobs.every((job) => job.nativeStatus === "completed" && job.waitObserved && job.settledEventObserved);
    }
    return receipt();
  }
  return Object.freeze({
    start() {
      if (disposed) failure("TRANSACTION_DISPOSED");
      if (!promise) {
        promise = run();
        promise.catch(() => {
        });
      }
      return receipt();
    },
    status() {
      return receipt();
    },
    async result() {
      if (!promise) failure("TRANSACTION_NOT_STARTED");
      return promise;
    },
    requestCancel() {
      if (!disposed && !state.operational.serverSettled) state.operational.cancelRequested = true;
      return receipt();
    },
    dispose() {
      if (promise && !state.operational.serverSettled) failure("TRANSACTION_STILL_RUNNING");
      if (state.operational.leaseRetained) failure("RESTORE_REQUIRES_OPERATOR");
      disposed = true;
      return { disposed: true, transactionId: cfg.transactionId };
    }
  });
}
export {
  INTEGRATION_CONTRACT,
  PINNED_API_PROOF,
  PINNED_SOURCE_ROOT,
  PLAN,
  createRunnerKanbanGate,
  installNativeLifecycleTransaction
};
