import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModel } from "../navigator/aliases.js";
import {
  deleteModelConfig,
  listModelConfigs,
  ModelConfigFile,
  readModelConfig,
  ThinkingSection,
  updateThinkingSection,
} from "../navigator/modelConfigs.js";
import {
  NOT_APPLICABLE,
  allowedEffortsFor,
  defaultEffortFor,
  effortFieldFor,
} from "../navigator/thinking.js";

type EffortField = "reasoning_effort" | "output_config.effort";

export function registerThinkingDefaultTools(server: McpServer): void {
  server.tool(
    "navigator_manage_thinking_defaults",
    [
      "Manage per-model thinking-effort defaults stored under",
      "{configDir}/model_configs/{model}.json in the `.thinking` section.",
      "Accepts action: 'configure' | 'get' | 'list' | 'delete'.",
      "",
      "Examples:",
      "  configure: { action:'configure', model_or_alias:'gpt-4o', value:'not_applicable' }",
      "  configure: { action:'configure', model_or_alias:'claude-4.7-opus', value:'high' }",
      "  get:       { action:'get',       model_or_alias:'gpt-5.4' }",
      "  list:      { action:'list' }",
      "  delete:    { action:'delete',    model_or_alias:'gpt-4o' }",
      "",
      "`value` may be a valid effort level for the model, or the literal",
      "'not_applicable' to opt a model out of reasoning_effort entirely.",
      "If `allowed_efforts` / `effort_field` are omitted on configure, they",
      "are bootstrapped from internal family tables.",
    ].join("\n"),
    {
      action: z
        .enum(["configure", "get", "list", "delete"])
        .describe("Which operation to perform"),
      model_or_alias: z
        .string()
        .optional()
        .describe("Model ID or alias (required for configure/get/delete)"),
      value: z
        .string()
        .optional()
        .describe(
          "Required for configure: effort level (e.g. 'low', 'high', 'xhigh', 'max') or 'not_applicable'",
        ),
      allowed_efforts: z
        .array(z.string())
        .optional()
        .describe(
          "Optional for configure: ordered vocabulary. If omitted, bootstrapped from family tables.",
        ),
      effort_field: z
        .enum(["reasoning_effort", "output_config.effort"])
        .nullable()
        .optional()
        .describe(
          "Optional for configure: request-body field to set ('reasoning_effort' | 'output_config.effort' | null for not_applicable). If omitted, bootstrapped.",
        ),
    },
    async (args) => {
      try {
        switch (args.action) {
          case "configure":
            return textOut(doConfigure(args));
          case "get":
            return textOut(doGet(args));
          case "list":
            return textOut(doList());
          case "delete":
            return textOut(doDelete(args));
          default:
            return textOut({
              action: args.action,
              ok: false,
              error: `Unknown action "${String(args.action)}"`,
            });
        }
      } catch (err) {
        return textOut({
          action: args.action,
          ok: false,
          error: (err as Error).message,
        });
      }
    },
  );
}

// ── Response envelope ─────────────────────────────────────────────────────────

function textOut(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

// ── Action handlers ───────────────────────────────────────────────────────────

interface ToolArgs {
  action: "configure" | "get" | "list" | "delete";
  model_or_alias?: string;
  value?: string;
  allowed_efforts?: string[];
  effort_field?: EffortField | null;
}

function doConfigure(args: ToolArgs) {
  if (!args.model_or_alias) {
    return {
      action: "configure" as const,
      ok: false,
      error: "configure requires `model_or_alias`.",
    };
  }
  if (args.value === undefined) {
    return {
      action: "configure" as const,
      ok: false,
      error: "configure requires `value` (an effort level or 'not_applicable').",
    };
  }

  const { resolvedModel } = resolveModel(args.model_or_alias);
  const value = args.value.toLowerCase();

  const prior = readModelConfig(resolvedModel)?.thinking;
  const previous_value = prior?.default_effort ?? null;

  // Bootstrap missing fields.
  const bootstrappedAllowed = allowedEffortsFor(resolvedModel);
  const allowed_efforts = args.allowed_efforts ?? bootstrappedAllowed;
  // If user sets not_applicable, effort_field should be null.
  const effort_field: EffortField | null =
    value === NOT_APPLICABLE
      ? null
      : args.effort_field !== undefined
        ? args.effort_field
        : effortFieldFor(resolvedModel);

  // Validate: if not not_applicable, must be in allowed_efforts (when vocab is non-empty).
  if (value !== NOT_APPLICABLE) {
    if (allowed_efforts.length > 0 && !allowed_efforts.includes(value)) {
      return {
        action: "configure" as const,
        ok: false,
        model: resolvedModel,
        error:
          `Invalid value "${args.value}" for model "${resolvedModel}". ` +
          `Allowed: ${allowed_efforts.join(", ")} (or "not_applicable").`,
      };
    }
    if (effort_field === null) {
      return {
        action: "configure" as const,
        ok: false,
        model: resolvedModel,
        error:
          `effort_field cannot be null unless value is "not_applicable".`,
      };
    }
  }

  const section: ThinkingSection = {
    default_effort: value,
    allowed_efforts: value === NOT_APPLICABLE ? [] : allowed_efforts,
    effort_field,
  };
  updateThinkingSection(resolvedModel, section);

  return {
    action: "configure" as const,
    ok: true,
    model: resolvedModel,
    value,
    previous_value,
    effort_field,
    source: "user_configured" as const,
  };
}

function doGet(args: ToolArgs) {
  if (!args.model_or_alias) {
    return { action: "get" as const, ok: false, error: "get requires `model_or_alias`." };
  }
  const { resolvedModel } = resolveModel(args.model_or_alias);
  const file = readModelConfig(resolvedModel);
  const thinking = file?.thinking ?? null;
  const seed_value = defaultEffortFor(resolvedModel) ?? null;
  const source: "file" | "code_seed" | "none" =
    thinking ? "file" : seed_value ? "code_seed" : "none";
  return {
    action: "get" as const,
    ok: true,
    model: resolvedModel,
    file,
    thinking,
    seed_value,
    source,
  };
}

function doList() {
  const { configs, skipped_unreadable } = listModelConfigs();
  // Filter to configs with a thinking section — the tool is thinking-scoped.
  const filtered = configs.filter(
    (c): c is ModelConfigFile & { thinking: ThinkingSection } =>
      c.thinking !== undefined,
  );
  return {
    action: "list" as const,
    ok: true,
    configs: filtered,
    count: filtered.length,
    skipped_unreadable,
  };
}

function doDelete(args: ToolArgs) {
  if (!args.model_or_alias) {
    return { action: "delete" as const, ok: false, error: "delete requires `model_or_alias`." };
  }
  const { resolvedModel } = resolveModel(args.model_or_alias);
  const had = readModelConfig(resolvedModel)?.thinking !== undefined;
  updateThinkingSection(resolvedModel, null);
  // If the file had thinking, we removed it; updateThinkingSection also deletes
  // the whole file if no other sections remained.
  return {
    action: "delete" as const,
    ok: true,
    model: resolvedModel,
    deleted: had,
  };
}
