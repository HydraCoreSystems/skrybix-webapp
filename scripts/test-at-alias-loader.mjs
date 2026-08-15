// Minimal ESM resolver hook used ONLY for running route-level tests
// directly under Node's native TypeScript stripping (node --test), the
// same way lib/commerce-export.test.ts already runs without a bundler.
// Route files use two specifier shapes plain Node cannot resolve on its
// own: the "@/..." path alias (Next's bundler/tsconfig resolve this,
// Node does not) and Next's own extensionless "next/server" subpath
// (next's package.json has no "exports" map, so Node's strict ESM
// resolution needs the real "next/server.js" file explicitly). Neither
// changes what code runs -- this only teaches Node's resolver the same
// mapping the bundler already applies at build time.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let abs = path.join(projectRoot, specifier.slice(2));
    if (!path.extname(abs)) {
      for (const ext of [".ts", ".tsx", ".js"]) {
        if (existsSync(abs + ext)) {
          abs += ext;
          break;
        }
      }
    }
    return nextResolve(pathToFileURL(abs).href, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith("next/") && !path.extname(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
