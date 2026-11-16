import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { MCP_TOOL_PREFIX } from './domain/mcp-allowlist.js';
import { PRODUCT_TOOL_NAMES } from './host/tools/names.js';

/** One role's tool boundary, declared by the preset that mounts this plugin. */
export interface Config {
  /** The product tools this role may use. Every other product tool is denied. */
  allow: string[];
  /** Deny every MCP server's tools regardless of a board's allowlist. */
  denyMcp: boolean;
}

export const Config: Schema<Partial<Config>, Config> = Schema.object({
  allow: Schema.array(Schema.string())
    .default([])
    .description('Product tool names this role may use. Every other product tool is hidden from the agent.'),
  denyMcp: Schema.boolean()
    .default(false)
    .description('Hide every MCP server tool from the agent, independent of the board MCP allowlist.'),
});

export const name = 'kanban-preset-tools';

export const inject = ['tools'];

/**
 * Apply one role's product-tool boundary inside the preset's own agent scope.
 *
 * The mask denies only product tools outside the role's allowlist, so it never
 * names an MCP tool the board may allow, and it is recomputed from the live
 * registry so a tool the host has not registered yet is skipped instead of
 * failing the preset. Deny masks from several scopes compose by union, which is
 * what lets the board's own MCP policy stay independent of this one.
 */
export function apply(ctx: Context, config: Partial<Config>): void {
  const allowed = new Set(config.allow ?? []);
  let mask: (() => void) | undefined;
  let applied: readonly string[] = [];
  const applyMask = (): void => {
    const registered = new Set(ctx.tools.definitions().map(definition => definition.name));
    const deniedProducts = PRODUCT_TOOL_NAMES.filter(tool => registered.has(tool) && !allowed.has(tool));
    const deniedMcp = config.denyMcp === true ? [...registered].filter(tool => tool.startsWith(MCP_TOOL_PREFIX)) : [];
    const deny = [...deniedProducts, ...deniedMcp];
    // Replacing the mask emits the same change notification that triggers this refresh.
    // An unchanged set needs no write, which also keeps the notification from spreading.
    if (mask !== undefined && deny.length === applied.length && deny.every((tool, index) => tool === applied[index])) return;
    mask?.();
    mask = undefined;
    applied = deny;
    if (deny.length > 0) mask = ctx.tools.restrict({ deny });
  };
  // Applying or lifting a mask emits the registry's own change notification, so this
  // plugin's listener would reenter itself. One guard keeps a catalog change from
  // recursing through this plugin's own effect.
  let refreshing = false;
  const refresh = (): void => {
    if (refreshing) return;
    refreshing = true;
    try { applyMask(); } finally { refreshing = false; }
  };
  refresh();
  ctx.on('tools/change', refresh);
  ctx.effect(() => () => { mask?.(); mask = undefined; });
}
