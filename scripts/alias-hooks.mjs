import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Next ships "next/server" as a CommonJS file without an exports map.
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier.startsWith("@/")) {
    const without = specifier.slice(2);
    const hit = firstExisting([
      join(srcRoot, `${without}.ts`),
      join(srcRoot, `${without}.tsx`),
      join(srcRoot, without, "index.ts"),
      join(srcRoot, without),
    ]);
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const base = join(parentDir, specifier);
    const hit = firstExisting([`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]);
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
