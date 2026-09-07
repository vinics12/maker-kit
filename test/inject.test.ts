import { describe, it, expect } from "vitest";
import { upsertBlock, stripBlock, hasBlock } from "../src/addons/inject.js";

describe("inject: upsert/strip", () => {
  const id = "saas";

  it("substitui o placeholder na primeira inserção", () => {
    const doc = "## Princípios\n\n_(nenhum princípio de projeto definido ainda)_\n\n## Governance";
    const out = upsertBlock(doc, id, "BLOCO", {
      replacePlaceholder: "_(nenhum princípio de projeto definido ainda)_",
      beforeHeading: "## Governance",
    });
    expect(out).toContain("BLOCO");
    expect(out).not.toContain("nenhum princípio");
    expect(hasBlock(out, id)).toBe(true);
  });

  it("é idempotente: reaplicar substitui o bloco, não duplica", () => {
    const doc = "x\n\n## Governance";
    const once = upsertBlock(doc, id, "A", { beforeHeading: "## Governance" });
    const twice = upsertBlock(once, id, "B", { beforeHeading: "## Governance" });
    expect(twice.match(/maker:addon:saas:start/g)?.length).toBe(1);
    expect(twice).toContain("B");
    expect(twice).not.toContain("A");
  });

  it("strip remove o bloco e volta ao conteúdo base", () => {
    const doc = "antes\n\n## Governance\ndepois";
    const injected = upsertBlock(doc, id, "BLOCO", { beforeHeading: "## Governance" });
    const stripped = stripBlock(injected, id);
    expect(hasBlock(stripped, id)).toBe(false);
    expect(stripped).toContain("antes");
    expect(stripped).toContain("## Governance");
    expect(stripped).not.toContain("BLOCO");
  });

  it("append ao EOF quando não há âncora", () => {
    const out = upsertBlock("só texto", id, "FRAG");
    expect(out).toContain("FRAG");
    expect(hasBlock(out, id)).toBe(true);
  });
});
