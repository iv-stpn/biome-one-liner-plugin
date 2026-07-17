import process from "node:process";
import { runFixer } from "./lib.ts";

const CONFIG = {
  label: "multiline object/array/type definitions",
  scriptName: "collapse-object-definitions.ts",
} as const;

if (require.main === module) runFixer(process.argv.slice(2), CONFIG);
