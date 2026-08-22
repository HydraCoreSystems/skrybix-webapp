// node:test's CLI file-selection applies glob matching to its arguments,
// and the acknowledge route's directory name ("[recordId]") is itself
// valid glob bracket-expression syntax -- passing that path on the CLI
// gets misinterpreted as a character class instead of a literal
// directory name, so the real test file is never found no matter how it
// is quoted/escaped. Importing it here by an explicit file:// URL
// sidesteps CLI glob matching entirely; node:test only cares that a
// module calling test() gets loaded before the run, not how.
import path from "node:path";
import { pathToFileURL } from "node:url";

await import(
  pathToFileURL(
    path.resolve(import.meta.dirname, "../app/api/commerce/v1/plants/[recordId]/acknowledge/route.test.ts")
  ).href
);
