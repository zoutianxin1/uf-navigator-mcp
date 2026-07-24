/**
 * M3: the allowlist denial message must mention the alias the user typed when
 * they passed an alias, not just the resolved model id. Otherwise an agent
 * sees an error referring to a Claude version it never asked for.
 *
 * The text builder is a tiny pure function we exercise via a hand-rolled
 * import from the inference tool source. We can't easily unit-test the full
 * MCP server.tool callback without booting the SDK, so we cover the contract
 * the callback delegates to.
 */

import { describe, expect, it } from "vitest";

import { buildAllowlistDeniedText as build } from "../src/tools/inference.js";

describe("buildAllowlistDeniedText — alias-aware denial", () => {
  it("mentions only the resolved id when the call was a literal", () => {
    const msg = build("gpt-4o", "gpt-4o", "literal");
    expect(msg).toContain('Model "gpt-4o"');
    expect(msg).not.toContain("Alias");
  });

  it("mentions both alias and resolved id when source is alias", () => {
    const msg = build("latest_anthropic", "claude-4.7-opus", "alias");
    expect(msg).toContain('Alias "latest_anthropic"');
    expect(msg).toContain('"claude-4.7-opus"');
    expect(msg).toContain("→");
  });

  it("falls back to the literal form when alias and resolved happen to match", () => {
    // Edge case: user typed an alias whose target id is identical to the alias
    // string (rare but legal). Avoid the awkward `Alias "foo" → "foo"` form.
    const msg = build("gpt-4o", "gpt-4o", "alias");
    expect(msg).toContain('Model "gpt-4o"');
    expect(msg).not.toContain("Alias");
  });

  it("includes the navigator_list_models hint", () => {
    const msg = build("gpt-4o", "gpt-4o", "literal");
    expect(msg).toContain("navigator_list_models");
  });
});
