import { readFile } from "node:fs/promises";

export async function loadLiveKeys(file = ".env.key") {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const result = { etherscan: [], alchemy: [], moralis: [] };
  let current = null;
  let unlabelledGroup = [];
  const unlabelledGroups = [];

  const finishUnlabelledGroup = () => {
    if (unlabelledGroup.length > 0) {
      unlabelledGroups.push(unlabelledGroup);
      unlabelledGroup = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const isComment = line.startsWith("#");
    const label = line.replace(/^#+\s*/, "").toLowerCase();
    if (isComment && label.includes("etherscan")) {
      finishUnlabelledGroup();
      current = "etherscan";
    } else if (isComment && label.includes("alchemy")) {
      finishUnlabelledGroup();
      current = "alchemy";
    } else if (isComment && label.includes("moralis")) {
      finishUnlabelledGroup();
      current = "moralis";
    } else if (line === "") {
      if (current === null) finishUnlabelledGroup();
    } else if (!isComment) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
      const assignmentName = assignment?.[1]?.toLowerCase() ?? "";
      const assignmentValue = assignment?.[2]?.trim();
      const assignmentKind = assignmentName.includes("etherscan")
        ? "etherscan"
        : assignmentName.includes("alchemy")
          ? "alchemy"
          : assignmentName.includes("moralis")
            ? "moralis"
            : null;
      if (assignmentKind !== null && assignmentValue !== undefined) {
        finishUnlabelledGroup();
        current = assignmentKind;
        result[assignmentKind].push(assignmentValue);
      } else if (current === null) unlabelledGroup.push(line);
      else result[current].push(line);
    }
  }
  finishUnlabelledGroup();

  if (result.etherscan.length === 0 && result.alchemy.length === 0 && result.moralis.length === 0) {
    const kinds = ["etherscan", "alchemy", "moralis"];
    for (const [index, group] of unlabelledGroups.entries()) {
      const kind = kinds[index];
      if (kind !== undefined) result[kind].push(...group);
    }
  }
  return result;
}

export function createLiveConfiguration(keys, options = {}) {
  const providers = ["etherscan", "alchemy", "moralis"]
    .filter((kind) => keys[kind]?.length > 0)
    .map((kind) => ({ kind, apiKeys: keys[kind] }));
  const proxyUrl = options.proxyUrl ?? null;
  return {
    providers,
    requestPolicy: {
      allowDirect: options.allowDirect ?? proxyUrl === null,
      maxTotalAttempts: options.maxTotalAttempts ?? 2,
      totalTimeoutMs: options.totalTimeoutMs ?? 20_000,
    },
    ...(proxyUrl === null ? {} : { proxies: [{ url: proxyUrl }] }),
  };
}
