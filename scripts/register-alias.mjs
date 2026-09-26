import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./alias-hooks.mjs", import.meta.url), pathToFileURL("./"));
