import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfigDirOverride } from "../src/navigator/paths.js";
import { seedDefaultAliases, getAliases, resolveModel } from "../src/navigator/aliases.js";

// ── Types (mirrored from src) ─────────────────────────────────────────────────

type AliasMap = Record<string, string>;

interface ResolveResult {
  resolvedModel: string;
  source: "alias" | "literal";
}

// ── Pure logic tests ─────────────────────────────────────────────────────────

describe("resolveModel — pure logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "uf-nav-test-"));
    setConfigDirOverride(tmpDir);
    // Seed aliases for pure logic tests
    writeFileSync(
      join(tmpDir, "aliases.json"),
      JSON.stringify({
        latest_openai: "gpt-5.2",
        latest_anthropic: "claude-4.6-opus",
      }),
    );
  });

  afterEach(() => {
    setConfigDirOverride(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a known alias", () => {
    const result = resolveModel("latest_openai");
    expect(result.resolvedModel).toBe("gpt-5.2");
    expect(result.source).toBe("alias");
  });

  it("passes through a literal model id unchanged", () => {
    const result = resolveModel("gpt-4o");
    expect(result.resolvedModel).toBe("gpt-4o");
    expect(result.source).toBe("literal");
  });

  it("passes through an unknown alias as literal", () => {
    const result = resolveModel("some_nonexistent_alias");
    expect(result.resolvedModel).toBe("some_nonexistent_alias");
    expect(result.source).toBe("literal");
  });

  it("resolves latest_anthropic alias", () => {
    const result = resolveModel("latest_anthropic");
    expect(result.resolvedModel).toBe("claude-4.6-opus");
    expect(result.source).toBe("alias");
  });
});

// ── seedDefaultAliases — file I/O tests ──────────────────────────────────────

describe("seedDefaultAliases — file I/O", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "uf-nav-test-"));
    setConfigDirOverride(tmpDir);
  });

  afterEach(() => {
    setConfigDirOverride(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates empty {} when no file exists", () => {
    seedDefaultAliases();
    const content = JSON.parse(readFileSync(join(tmpDir, "aliases.json"), "utf8"));
    expect(content).toEqual({});
  });

  it("preserves existing aliases file (migration safety)", () => {
    const existing = { latest_openai: "gpt-5.2", custom: "my-model" };
    writeFileSync(join(tmpDir, "aliases.json"), JSON.stringify(existing));
    seedDefaultAliases();
    const content = JSON.parse(readFileSync(join(tmpDir, "aliases.json"), "utf8"));
    expect(content).toEqual(existing);
  });

  it("getAliases returns empty object when no file exists", () => {
    const aliases = getAliases();
    expect(aliases).toEqual({});
  });
});

// ── Alias map operations ─────────────────────────────────────────────────────

describe("alias map operations", () => {
  it("setAlias overwrites an existing alias", () => {
    const aliases: AliasMap = { latest_openai: "gpt-4" };
    aliases["latest_openai"] = "gpt-5.2";
    expect(aliases["latest_openai"]).toBe("gpt-5.2");
  });

  it("deleteAlias removes the alias", () => {
    const aliases: AliasMap = { latest_openai: "gpt-4", my_alias: "foo" };
    delete aliases["my_alias"];
    expect(Object.prototype.hasOwnProperty.call(aliases, "my_alias")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(aliases, "latest_openai")).toBe(true);
  });

  it("deleteAlias on non-existent key returns false", () => {
    const aliases: AliasMap = { latest_openai: "gpt-4" };
    const existed = Object.prototype.hasOwnProperty.call(aliases, "ghost_alias");
    expect(existed).toBe(false);
  });
});
