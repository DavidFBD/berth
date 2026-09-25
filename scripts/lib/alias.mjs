// Registers alias-hooks.mjs; see there.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
