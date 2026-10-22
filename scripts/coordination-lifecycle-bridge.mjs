import { createRunnerKanbanGate, installNativeLifecycleTransaction } from "./native-coordination-lifecycle.mjs";
const BRIDGE_CONTRACT = Object.freeze({
  status: "prepared-not-executed",
  nativeJournalGate: "not-verified",
  realm: "Both frozen factories execute by serialized function declaration on the same actual Host root. Only Host objectId arguments carry gate/controller/outside references. No Node promise callbacks or by-value substitutes.",
  routing: "ALL future runner setup/main/preflight/post-restore/cleanup command and snapshot calls must use invoke/recover/ack. After lifecycle start, mutation admission is restricted to public cleanup/recovery for the installed own task/session IDs; broader runner work needs a separately reviewed scope, never a peer-repair bypass. Installation of the independent native controller is a separate reviewed Host factory on rootTarget(), in this exact connection/group.",
  preparedGateClose: "closePreparedGateOnly is only for the normal prepared app gate, with an exclusively bridge-owned object group and no current/ever independent binding, transaction, manual lease, or exposed Root/factory target. prepare returns metadata only. Stage A uses invoke/recover/ack, never a Bridge Root target; any independent native controller uses its own separate group and independently derived Root. The close pauses/drains/seals the actual public server ledger, confirms all outcomes ACKed, and drops only bridge references/listeners. It is NOT lifecycle disposal or native journal evidence.",
  receipts: "invoke/recover returns private ordinary RPC data plus an opaque Node receipt. Validate business outcome and exact ownership/creation receipt before ack. Never log that private value.",
  leases: "Manual acquireLease is metadata-only quiescence preparation. Release it before starting lifecycle: the frozen transaction acquires its own lease. A timed-out acquisition with no returned reference is UNVERIFIED, not a presumed held lease.",
  lifetime: "Do not release the group, dispose guards/controller, run app cleanup, or issue new app RPC from lifecycle start-send until the same server receipt proves applied ON plus terminal actual work/jobs. This bridge never disposes the independent native controller or closes the caller-owned connection. The external owner must manage controller teardown before releasing its last reference; assertDisposalReady must remain able to verify public settled/read/base/prefix facts after an already-safe controller teardown, or the owner must retain another independently owned reference.",
  unknown: "Known client deadlines do not cancel server promises. Recover only the same server handle/receipt. Lost connection or unknown protocol is permanently UNVERIFIED: retain-required, no reconnect, restore call, new app RPC, or pretend-held lease.",
  limits: "Object-reference/root identity is a construction guard, not universal realm attestation. Exclusive operator window and same-server construction remain reviewed assumptions. Server-process death has no in-memory finally guarantee. A successful bridge/window is not native journal proof."
});
const INDEPENDENT_CONTROLLER_CONTRACT = Object.freeze({
  key: "dsh-kanban.uat.independent-controller.v1",
  contract: "independent-native-controller-v1",
  shape: "Helper-owned nonserializable Symbol.for(key) brand {contract,root:actualHostRoot}, plus assertRetained(), settleOwnedWhileOff(permit), and assertDisposalReady(permit). Brand at creation inside the independent Host factory; do not stamp arbitrary objects.",
  methods: "assertRetained validates actual retained independent guards/agents/resources through public APIs. settleOwnedWhileOff awaits the approved actual producer and every inner resource. assertDisposalReady throws unless actual resources/jobs are settled and read, known actors are at canonical base and history prefixes remain intact through public APIs. These methods never invoke Kanban while OFF or manufacture native status.",
  scope: "This is an interface for later SDK324 integration, not a production service, Core property, runtime test hook, or currently executed native controller."
});
const references = /* @__PURE__ */ new WeakMap(), receipts = /* @__PURE__ */ new WeakMap(), leases = /* @__PURE__ */ new WeakMap();
const safe = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(value);
const groupName = (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value);
class LifecycleBridgeFailure extends Error {
  constructor(code) {
    super("Lifecycle bridge: " + code);
    this.name = "LifecycleBridgeFailure";
    this.code = code;
    this.nativeJournalGate = "not-verified";
  }
}
const fail = (code) => {
  throw new LifecycleBridgeFailure(code);
};
function json(value) {
  const seen = /* @__PURE__ */ new Set();
  const visit = (item, array = false) => {
    if (item === void 0) {
      if (array) fail("NON_JSON_ARGUMENT");
      return;
    }
    if (item === null || ["string", "boolean"].includes(typeof item)) return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("NON_JSON_ARGUMENT");
      return;
    }
    if (typeof item !== "object" || seen.has(item)) fail("NON_JSON_ARGUMENT");
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, true);
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail("NON_JSON_ARGUMENT");
      if (Object.getOwnPropertySymbols(item).length) fail("NON_JSON_ARGUMENT");
      for (const child of Object.values(item)) visit(child);
    }
    seen.delete(item);
  };
  visit(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail("NON_JSON_ARGUMENT");
  }
}
function hostObjectReference(connection, objectGroup, descriptor) {
  if (!connection || typeof connection.call !== "function" || !groupName(objectGroup) || descriptor?.type !== "object" || typeof descriptor.objectId !== "string" || !descriptor.objectId.length || descriptor.objectId.length > 2048 || [...descriptor.objectId].some((c) => c.charCodeAt(0) < 32)) fail("HOST_REFERENCE_INVALID");
  const ref = Object.freeze({ kind: "opaque-host-reference" });
  references.set(ref, { connection, socket: connection.socket, objectGroup, objectId: descriptor.objectId });
  return ref;
}
function normalizeHostRoot() {
  const root = this.root ?? this;
  if (!root || typeof root.get !== "function") throw new Error("HOST_ROOT_REQUIRED");
  return root;
}
function retainIdentity() {
  return this;
}
function buildOutside(gate, controller) {
  const root = this.root ?? this, brand = controller?.[Symbol.for("dsh-kanban.uat.independent-controller.v1")];
  if (brand?.contract !== "independent-native-controller-v1" || brand.root !== root || typeof controller.assertRetained !== "function" || typeof controller.settleOwnedWhileOff !== "function" || typeof controller.assertDisposalReady !== "function") throw new Error("INDEPENDENT_HOST_CONTROLLER_REQUIRED");
  return Object.freeze({ gate, assertRetained() {
    return controller.assertRetained();
  }, settleOwnedWhileOff(permit) {
    return controller.settleOwnedWhileOff(permit);
  } });
}
async function proveFinalDisposal(transaction, controller, permit) {
  const root = this.root ?? this, brand = controller?.[Symbol.for("dsh-kanban.uat.independent-controller.v1")];
  if (brand?.contract !== "independent-native-controller-v1" || brand.root !== root || typeof controller.assertDisposalReady !== "function") return { ready: false, code: "INDEPENDENT_DISPOSAL_UNVERIFIED" };
  const status = transaction.status();
  if (status.transactionId !== permit.transactionId || status.operational?.serverSettled !== true || status.operational.restorationConfirmed !== true || status.operational.onApplication !== "applied") return { ready: false, code: "SERVER_RESTORATION_UNVERIFIED" };
  try {
    await controller.assertDisposalReady(permit);
  } catch {
    return { ready: false, code: "INDEPENDENT_DISPOSAL_NOT_READY" };
  }
  return { ready: true, transactionId: permit.transactionId, proof: "independent-public-disposal-assertion-v1" };
}
function sealPreparedGateOnly(gate, lease) {
  lease.assertHeld();
  lease.seal();
  const paused = [gate.status(), lease.status()];
  if (paused.some((value) => value.scope !== "runner-owned-only" || value.admissionsPaused !== true || value.inFlight !== 0 || value.unknownOutcomes !== 0)) throw new Error("PREPARED_GATE_LEDGER_UNVERIFIED");
  return { version: "prepared-gate-seal-v1", scope: "runner-owned-only", admissionsPaused: true, sealed: true, inFlight: 0, unknownOutcomes: 0 };
}
function invokeFixedMethod(method, args) {
  if (!["begin", "result", "acknowledge", "status", "acquire", "assertHeld", "seal", "release", "start", "requestCancel", "dispose"].includes(method) || !Array.isArray(args) || typeof this[method] !== "function") throw new Error("FIXED_HOST_METHOD_REQUIRED");
  const result = this[method](...args);
  return method === "release" && result === void 0 ? { released: true } : result;
}
function kanbanPresence() {
  return { present: !!(this.root ?? this).get("kanbanController") };
}
function createCoordinationLifecycleBridge(config = {}) {
  if (Object.keys(config).some((key) => !["connection", "objectGroup", "allowOwnerTest", "allowFixtureData"].includes(key))) fail("BRIDGE_ARGUMENT_INVALID");
  const { connection, objectGroup, allowOwnerTest, allowFixtureData } = config;
  if (allowOwnerTest !== true || allowFixtureData !== true) fail("BRIDGE_NOT_AUTHORIZED");
  if (!connection || typeof connection.call !== "function" || !connection.socket || !groupName(objectGroup)) fail("EXISTING_HOST_CONNECTION_REQUIRED");
  let root, gate, outside, transaction, controllerRef, prepared = false, started = false, disposed = false, unverified = false, reason, latest, installed, manualLease, installPending = false, preparing = false, binding = false, disposing = false, preparedGateClosing = false, preparedGateClosed = false, preparedCloseReceipt, activeRequests = 0;
  const gateOnlyHazards = { rootExposed: false, binding: false, installation: false, start: false, lease: false };
  const calls = /* @__PURE__ */ new Map(), socket = connection.socket, originalCall = connection.call;
  const open = () => connection.disposed !== true && connection.socket === socket && connection.call === originalCall && socket.readyState === 1;
  const poison = (code) => {
    unverified = true;
    reason = code;
  };
  const assertOpen = () => {
    if (preparedGateClosed) fail("PREPARED_GATE_CLOSED");
    if (disposed) fail("BRIDGE_DISPOSED");
    if (unverified) fail("BRIDGE_UNVERIFIED");
    if (!open()) {
      poison("HOST_CONNECTION_LOST");
      fail("BRIDGE_UNVERIFIED");
    }
  };
  const assertNotPreparedClosing = () => {
    if (preparedGateClosing) fail("PREPARED_GATE_CLOSING");
  };
  const lost = () => {
    if (!disposed && !preparedGateClosed) poison("HOST_CONNECTION_LOST");
  };
  connection.socket.addEventListener?.("close", lost);
  connection.socket.addEventListener?.("error", lost);
  const knownDeadline = (error, method) => error?.code === "INSPECTOR_CLIENT_DEADLINE" || error?.message === "CDP " + method + " timed out; a requested mutation may STILL be running";
  const pointer = (ref) => {
    const value = references.get(ref);
    if (!value || value.connection !== connection || value.socket !== socket || value.objectGroup !== objectGroup) fail("HOST_REFERENCE_SCOPE_MISMATCH");
    return value;
  };
  const dispatch = async (method, params) => {
    assertOpen();
    activeRequests++;
    try {
      const value = await connection.call(method, params);
      if (unverified || !open()) {
        poison("HOST_CONNECTION_LOST");
        fail("BRIDGE_UNVERIFIED");
      }
      return value;
    } catch (error) {
      if (error instanceof LifecycleBridgeFailure) throw error;
      if (open() && !unverified && knownDeadline(error, method)) fail("CLIENT_DEADLINE_SERVER_CONTINUES");
      poison("HOST_CONNECTION_OR_PROTOCOL_UNKNOWN");
      fail("BRIDGE_UNVERIFIED");
    } finally {
      activeRequests--;
    }
  };
  const runtime = async (ref, declaration, args, byValue2 = true) => {
    const target = pointer(ref);
    const value = await dispatch("Runtime.callFunctionOn", { objectId: target.objectId, objectGroup, functionDeclaration: declaration, arguments: args, returnByValue: byValue2, awaitPromise: true });
    if (!value || value.exceptionDetails || !value.result) {
      poison("HOST_EVALUATION_UNVERIFIED");
      fail("BRIDGE_UNVERIFIED");
    }
    if (byValue2) {
      if (!Object.hasOwn(value.result, "value")) {
        poison("HOST_VALUE_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
      return value.result.value;
    }
    try {
      return hostObjectReference(connection, objectGroup, value.result);
    } catch {
      poison("HOST_REFERENCE_UNVERIFIED");
      fail("BRIDGE_UNVERIFIED");
    }
  };
  const byValue = (ref, method, args = []) => runtime(ref, invokeFixedMethod.toString(), [{ value: method }, { value: json(args) }]);
  const acquireReference = async (action) => {
    try {
      return await action();
    } catch (error) {
      if (error?.code === "CLIENT_DEADLINE_SERVER_CONTINUES") poison("HOST_REFERENCE_RESULT_UNKNOWN");
      throw error;
    }
  };
  const acknowledged = () => [...calls.values()].every((row) => row.acknowledged);
  const terminal = (value) => ["completed", "failed", "killed"].includes(value);
  const restored = () => latest?.operational?.serverSettled === true && latest.operational.restorationConfirmed === true && latest.operational.onSettled === true && latest.operational.onApplication === "applied" && latest.operational.leaseRetained === false && latest.operational.workSettled === true && latest.nativeJobs.length === installed?.jobs.length && latest.nativeJobs.every((job) => terminal(job.nativeStatus) && job.waitObserved === true && job.settledEventObserved === true);
  const cleanupScope = (kind, args) => {
    if (!started || kind === "snapshot") return;
    const allowed = ["operation.return", "operation.retry", "worktree.remove", "task.delete", "task.edit", "conversation.close", "conversation.reopen"];
    if (!args || !allowed.includes(args.type) || !installed.ownedTaskIds.includes(args.taskId) || args.sessionId !== void 0 && !installed.ownedSessionIds.includes(args.sessionId)) fail("POST_ON_OWN_CLEANUP_REQUIRED");
    if (["worktree.remove", "task.delete"].includes(args.type)) {
      const target = args.expectedWorktreePath;
      if (args.confirmed !== true || target !== null && (typeof target !== "string" || !target.startsWith(installed.fixture.run + "/") || target === installed.fixture.base || installed.fixture.base.startsWith(target + "/") || target.split("/").some((part) => part === ".." || part === "."))) fail("OWN_CLEANUP_TARGET_UNVERIFIED");
    }
  };
  const appAllowed = () => {
    assertOpen();
    if (!prepared || preparedGateClosing || manualLease || installPending || disposing || [...calls.values()].some((row) => row.uncertain) || started && !restored()) fail("APP_ADMISSION_CLOSED");
  };
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
  const codes = new Set([...installNativeLifecycleTransaction.toString().matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)].map((match) => match[1]));
  const receiptShape = (value) => {
    if (!exact(value, ["version", "verificationScope", "nativeJournalGate", "transactionId", "bundleName", "operational", "quiescence", "nativeJobs", "errors", "ok"])) return false;
    const op = value.operational, q = value.quiescence;
    const bools = ["started", "serverSettled", "cancelRequested", "offAttempted", "offSettled", "offObserved", "onAttempted", "onSettled", "restorationConfirmed", "leaseRetained", "workPermitted", "workSettled"];
    if (!exact(op, ["phase", "originalEnabled", "offApplication", "onApplication", ...bools]) || bools.some((key) => typeof op[key] !== "boolean") || ![null, true, false].includes(op.originalEnabled) || !["prepared", "preflight", "disabling", "disabled", "settling-owned-work", "restoring", "complete"].includes(op.phase) || !["not-attempted", "unknown", "applied", "restart-required", "overridden", "cancelled", "failed"].includes(op.offApplication) || !["not-attempted", "unknown", "applied", "restart-required", "overridden", "cancelled", "failed"].includes(op.onApplication)) return false;
    const counts = ["foreignPendingOperations", "foreignPendingTransitions", "inFlightRunnerCalls", "unknownRunnerOutcomes"];
    if (!exact(q, ["scope", "externalClientsAtomicallyFenced", "exclusiveOperatorWindow", ...counts]) || q.scope !== "runner-owned-only" || q.externalClientsAtomicallyFenced !== false || q.exclusiveOperatorWindow !== true || counts.some((key) => q[key] !== null && (!Number.isSafeInteger(q[key]) || q[key] < 0))) return false;
    return Array.isArray(value.errors) && value.errors.every((code) => codes.has(code)) && Array.isArray(value.nativeJobs) && value.nativeJobs.every((job) => exact(job, ["jobId", "owner", "nativeStatus", "waitObserved", "settledEventObserved"]) && ["running", "stopping", "completed", "failed", "killed"].includes(job.nativeStatus) && typeof job.waitObserved === "boolean" && typeof job.settledEventObserved === "boolean");
  };
  const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
  const observe = (value) => {
    if (!receiptShape(value) || value.version !== "own-kanban-lifecycle-v1" || value.transactionId !== installed?.transactionId || value.bundleName !== "dsh-kanban" || value.verificationScope !== "transaction-window-only" || value.nativeJournalGate !== "not-verified" || !value.operational || !Array.isArray(value.nativeJobs) || !Array.isArray(value.errors) || typeof value.ok !== "boolean") {
      poison("SERVER_RECEIPT_UNVERIFIED");
      fail("BRIDGE_UNVERIFIED");
    }
    const expected = new Map(installed.jobs.map((job) => [job.id, job.owner]));
    if (value.nativeJobs.some((job) => expected.get(job.jobId) !== job.owner) || new Set(value.nativeJobs.map((job) => job.jobId)).size !== value.nativeJobs.length) {
      poison("SERVER_JOB_RECEIPT_UNVERIFIED");
      fail("BRIDGE_UNVERIFIED");
    }
    if (latest?.operational?.serverSettled === true) {
      if (value.operational.serverSettled !== true) return json(latest);
      if (stable(value) !== stable(latest)) {
        poison("TERMINAL_SERVER_RECEIPT_CHANGED");
        fail("BRIDGE_UNVERIFIED");
      }
    }
    latest = json(value);
    return json(latest);
  };
  const summary = () => preparedGateClosed ? preparedCloseReceipt : { state: unverified ? "UNVERIFIED" : preparedGateClosing ? "prepared-gate-closing" : disposed ? "disposed" : started ? restored() ? "terminal-restored" : "transaction-pending" : transaction ? "installed" : prepared ? "prepared" : "new", reason: reason ?? null, nativeJournalGate: "not-verified", admissionState: unverified ? "unknown" : !prepared ? "not-prepared" : preparedGateClosing || manualLease || started && !restored() ? "closed-required" : "runner-owned-gate", guardDisposition: "retain-required-not-disposed-by-bridge", pendingCallReceipts: [...calls.values()].filter((row) => !row.acknowledged).length, serverReceipt: latest ? json(latest) : null };
  const preparedOnly = () => prepared && root && gate && !preparedGateClosed && !preparing && !binding && !installPending && !disposing && !outside && !controllerRef && !transaction && !installed && !started && !manualLease && !Object.values(gateOnlyHazards).some(Boolean) && activeRequests === 0 && acknowledged() && ![...calls.values()].some((row) => row.uncertain);
  const readCall = async (callId) => {
    assertOpen();
    assertNotPreparedClosing();
    const row = calls.get(callId);
    if (!row) fail("CALL_NOT_ISSUED");
    if (started && !restored()) fail("APP_ADMISSION_CLOSED");
    let value;
    try {
      value = await byValue(gate, "result", [callId]);
    } catch (error) {
      if (!row.acknowledged) row.uncertain = true;
      throw error;
    }
    if (value?.callId !== callId || typeof value.delivery !== "string" || !value.delivery.length || !["fulfilled", "rejected"].includes(value.outcome) || value.outcome === "fulfilled" && !Object.hasOwn(value, "value")) {
      poison("APP_RECEIPT_UNVERIFIED");
      fail("BRIDGE_UNVERIFIED");
    }
    const receipt = Object.freeze(json(value));
    receipts.set(receipt, { owner: api, callId, delivery: value.delivery });
    row.delivered = receipt;
    return receipt;
  };
  const api = Object.freeze({
    state: summary,
    rootReference() {
      assertOpen();
      assertNotPreparedClosing();
      gateOnlyHazards.rootExposed = true;
      if (!prepared) fail("BRIDGE_NOT_PREPARED");
      return root;
    },
    inspectorTarget(ref) {
      assertOpen();
      assertNotPreparedClosing();
      gateOnlyHazards.rootExposed = true;
      const target = pointer(ref);
      return Object.freeze({ objectId: target.objectId, objectGroup });
    },
    async prepare() {
      assertOpen();
      assertNotPreparedClosing();
      if (prepared) return { prepared: true, objectGroup };
      if (root || gate || preparing) fail("BRIDGE_PREPARE_INCOMPLETE");
      preparing = true;
      try {
        const document = await dispatch("DOM.getDocument", { depth: 3 });
        const hosts = document?.root?.children?.filter((node) => node.localName === "host") ?? [];
        const contexts = hosts.length === 1 ? hosts[0].children?.filter((node) => node.localName === "context") ?? [] : [];
        if (contexts.length !== 1 || !Number.isSafeInteger(contexts[0].nodeId)) {
          poison("HOST_ROOT_UNVERIFIED");
          fail("BRIDGE_UNVERIFIED");
        }
        const resolved = await dispatch("DOM.resolveNode", { nodeId: contexts[0].nodeId, objectGroup });
        const initial = hostObjectReference(connection, objectGroup, resolved.object);
        root = await acquireReference(() => runtime(initial, normalizeHostRoot.toString(), [], false));
        gate = await acquireReference(() => runtime(root, createRunnerKanbanGate.toString(), [], false));
        prepared = true;
        return { prepared: true, objectGroup };
      } catch (error) {
        if (!unverified) poison("HOST_PREPARATION_UNVERIFIED");
        throw error;
      } finally {
        preparing = false;
      }
    },
    async bindIndependentController(ref) {
      gateOnlyHazards.binding = true;
      assertNotPreparedClosing();
      appAllowed();
      if (started || transaction || outside || binding) fail("CONTROLLER_BINDING_CLOSED");
      pointer(ref);
      binding = true;
      try {
        controllerRef = await acquireReference(() => runtime(ref, retainIdentity.toString(), [], false));
        outside = await acquireReference(() => runtime(root, buildOutside.toString(), [{ objectId: pointer(gate).objectId }, { objectId: pointer(controllerRef).objectId }], false));
        return { bound: true };
      } finally {
        binding = false;
      }
    },
    async invoke(kind, callId, args = {}) {
      appAllowed();
      if (!["command", "snapshot"].includes(kind) || !safe(callId) || calls.has(callId)) fail("APP_CALL_INVALID");
      cleanupScope(kind, args);
      const payload = json(args);
      appAllowed();
      const row = { acknowledged: false, uncertain: false, delivered: void 0 };
      calls.set(callId, row);
      try {
        const admitted = await byValue(gate, "begin", [kind, callId, payload]);
        if (admitted?.callId !== callId || admitted.state !== "pending") {
          poison("APP_ADMISSION_UNVERIFIED");
          fail("BRIDGE_UNVERIFIED");
        }
        return await readCall(callId);
      } catch (error) {
        if (!row.acknowledged) row.uncertain = true;
        throw error;
      }
    },
    recoverCall: readCall,
    async ack(receipt) {
      assertOpen();
      assertNotPreparedClosing();
      const data = receipts.get(receipt);
      if (data?.owner !== api) fail("APP_RECEIPT_SCOPE_MISMATCH");
      if (started && !restored()) fail("APP_ADMISSION_CLOSED");
      const row = calls.get(data.callId);
      let value;
      try {
        value = await byValue(gate, "acknowledge", [data.callId, data.delivery]);
      } catch (error) {
        if (!row.acknowledged) row.uncertain = true;
        throw error;
      }
      if (value?.callId !== data.callId || value.acknowledged !== true) {
        poison("APP_ACK_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
      row.acknowledged = true;
      row.uncertain = false;
      return { callId: data.callId, acknowledged: true };
    },
    async acquireLease(id) {
      gateOnlyHazards.lease = true;
      assertNotPreparedClosing();
      appAllowed();
      if (started || transaction || !acknowledged() || !safe(id)) fail("LEASE_NOT_ADMISSIBLE");
      manualLease = { pending: true };
      try {
        const ref = await acquireReference(() => runtime(gate, invokeFixedMethod.toString(), [{ value: "acquire" }, { value: [id] }], false));
        const token = Object.freeze({ kind: "opaque-runner-lease" });
        leases.set(token, { owner: api, ref });
        manualLease = token;
        return token;
      } catch (error) {
        if (!unverified) poison("LEASE_ACQUISITION_UNKNOWN");
        throw error;
      }
    },
    async leaseStatus(token) {
      gateOnlyHazards.lease = true;
      assertNotPreparedClosing();
      assertOpen();
      const data = leases.get(token);
      if (data?.owner !== api || manualLease !== token) fail("LEASE_SCOPE_MISMATCH");
      return byValue(data.ref, "status");
    },
    async releaseLease(token) {
      gateOnlyHazards.lease = true;
      assertNotPreparedClosing();
      assertOpen();
      const data = leases.get(token);
      if (data?.owner !== api || manualLease !== token || started) fail("LEASE_SCOPE_MISMATCH");
      let value;
      try {
        value = await byValue(data.ref, "release");
      } catch {
        poison("LEASE_RELEASE_OUTCOME_UNKNOWN");
        fail("BRIDGE_UNVERIFIED");
      }
      if (value?.released !== true) {
        poison("LEASE_RELEASE_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
      manualLease = void 0;
      return { released: true };
    },
    async install(options) {
      gateOnlyHazards.installation = true;
      assertNotPreparedClosing();
      appAllowed();
      if (!outside || transaction || started || !acknowledged()) fail("TRANSACTION_NOT_INSTALLABLE");
      installed = json(options);
      installPending = true;
      try {
        transaction = await acquireReference(() => runtime(root, installNativeLifecycleTransaction.toString(), [{ value: installed }, { objectId: pointer(outside).objectId }], false));
        return { installed: true, transactionId: installed.transactionId };
      } finally {
        installPending = false;
      }
    },
    async start() {
      gateOnlyHazards.start = true;
      assertNotPreparedClosing();
      assertOpen();
      if (!transaction || manualLease || !acknowledged()) fail("TRANSACTION_NOT_STARTABLE");
      started = true;
      return observe(await byValue(transaction, "start"));
    },
    async status() {
      if (preparedGateClosed) return preparedCloseReceipt;
      if (disposed) return summary();
      if (unverified || !open()) {
        if (!open()) poison("HOST_CONNECTION_LOST");
        return summary();
      }
      if (transaction && started) observe(await byValue(transaction, "status"));
      return summary();
    },
    async result() {
      assertOpen();
      if (!transaction || !started) fail("TRANSACTION_NOT_STARTED");
      return observe(await byValue(transaction, "result"));
    },
    async requestCancel() {
      assertOpen();
      if (!transaction || !started) fail("TRANSACTION_NOT_STARTED");
      return observe(await byValue(transaction, "requestCancel"));
    },
    async presence() {
      assertOpen();
      assertNotPreparedClosing();
      if (!root) fail("BRIDGE_NOT_PREPARED");
      const value = await runtime(root, kanbanPresence.toString(), []);
      if (typeof value?.present !== "boolean") {
        poison("PRESENCE_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
      return value;
    },
    async closePreparedGateOnly() {
      if (preparedGateClosed) return preparedCloseReceipt;
      assertOpen();
      if (preparedGateClosing || !preparedOnly()) fail("PREPARED_GATE_CLOSE_NOT_ELIGIBLE");
      preparedGateClosing = true;
      try {
        const lease = await acquireReference(() => runtime(gate, invokeFixedMethod.toString(), [{ value: "acquire" }, { value: ["prepared-close-" + objectGroup] }], false));
        const proof = await runtime(root, sealPreparedGateOnly.toString(), [{ objectId: pointer(gate).objectId }, { objectId: pointer(lease).objectId }]);
        if (!exact(proof, ["version", "scope", "admissionsPaused", "sealed", "inFlight", "unknownOutcomes"]) || proof.version !== "prepared-gate-seal-v1" || proof.scope !== "runner-owned-only" || proof.admissionsPaused !== true || proof.sealed !== true || proof.inFlight !== 0 || proof.unknownOutcomes !== 0 || !preparedOnly()) throw new Error("PREPARED_GATE_CLOSE_UNVERIFIED");
        await dispatch("Runtime.releaseObjectGroup", { objectGroup });
        if (!preparedOnly()) throw new Error("PREPARED_GATE_CLOSE_RACE");
        preparedCloseReceipt = Object.freeze({ version: "prepared-gate-close-v1", state: "preparedGateClosed", scope: "bridge-object-group-only", nativeJournalGate: "NOT_TESTED", nativeControllerOwnership: "NO_NATIVE_CONTROLLER_OWNED", lifecycleTransaction: "NOT_CREATED", serverGate: Object.freeze({ admissionsPaused: true, sealed: true, inFlight: 0, unknownOutcomes: 0 }), objectGroupReleased: true, connectionClosedByBridge: false, independentControllerDisposedByBridge: false, externalNativeControllerLifetime: "unchanged-not-owned" });
        preparedGateClosed = true;
        preparedGateClosing = false;
        socket.removeEventListener?.("close", lost);
        socket.removeEventListener?.("error", lost);
        return preparedCloseReceipt;
      } catch {
        poison("PREPARED_GATE_CLOSE_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
    },
    async dispose() {
      assertNotPreparedClosing();
      assertOpen();
      if (!started || !restored() || manualLease || !acknowledged() || disposing) fail("DISPOSE_NOT_SAFE");
      disposing = true;
      try {
        const permit = { transactionId: installed.transactionId, ownerIds: installed.ownedSessionIds, jobIds: installed.jobs.map((job) => job.id), base: installed.fixture.base };
        const proof = await runtime(root, proveFinalDisposal.toString(), [{ objectId: pointer(transaction).objectId }, { objectId: pointer(controllerRef).objectId }, { value: permit }]);
        if (proof?.ready === false && proof.code === "INDEPENDENT_DISPOSAL_NOT_READY") {
          disposing = false;
          fail("DISPOSE_PUBLIC_PROOF_NOT_READY");
        }
        if (proof?.ready !== true || proof.transactionId !== installed.transactionId || proof.proof !== "independent-public-disposal-assertion-v1") {
          poison("DISPOSAL_PROOF_UNVERIFIED");
          fail("BRIDGE_UNVERIFIED");
        }
        const value = await byValue(transaction, "dispose");
        if (value?.disposed !== true || value.transactionId !== installed.transactionId) {
          poison("DISPOSE_UNVERIFIED");
          fail("BRIDGE_UNVERIFIED");
        }
        await dispatch("Runtime.releaseObjectGroup", { objectGroup });
        disposed = true;
        socket.removeEventListener?.("close", lost);
        socket.removeEventListener?.("error", lost);
        return { disposed: true, connectionClosedByBridge: false, independentControllerDisposedByBridge: false };
      } catch (error) {
        if (error?.code === "DISPOSE_PUBLIC_PROOF_NOT_READY") throw error;
        poison("DISPOSAL_OUTCOME_UNVERIFIED");
        fail("BRIDGE_UNVERIFIED");
      }
    }
  });
  return api;
}
export {
  BRIDGE_CONTRACT,
  INDEPENDENT_CONTROLLER_CONTRACT,
  LifecycleBridgeFailure,
  createCoordinationLifecycleBridge,
  hostObjectReference
};
