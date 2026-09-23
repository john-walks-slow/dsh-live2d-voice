/**
 * Build both halves of the plugin:
 *
 *   lib/index.js  — host entry, ESM bundle for Node (externals: @deepseek-ai/*).
 *   lib/client.js — browser half in the web shell's lazy-CJS wrapper
 *                   window.__ModuleLoader__.load({ id, factory }); react and
 *                   @deepseek-ai/* stay external requires; pixi.js and the
 *                   Live2D lipsync library are bundled.
 *   lib/types/client/index.d.ts — hand-written client-facing declaration.
 */

import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

await rm("lib", { recursive: true, force: true });
await mkdir("lib", { recursive: true });

// ---------- host ----------
await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	outfile: "lib/index.js",
	external: ["@deepseek-ai/*"],
	sourcemap: false,
	logLevel: "info",
});

// ---------- client ----------
const clientBundle = "lib/client.bundle.js";
await build({
	entryPoints: ["src/client/index.ts"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	outfile: clientBundle,
	jsx: "automatic",
	target: "es2022",
	minify: true,
	sourcemap: false,
	external: ["react", "react-dom/*", "react/jsx-runtime", "@deepseek-ai/*"],
	logLevel: "info",
});
const body = await readFile(clientBundle, "utf8");
const wrapped = [
	"window.__ModuleLoader__.load({",
	'\tid: "dsh-live2d-voice",',
	"\tfactory: (require) => {",
	"\t\tvar module = { exports: {} };",
	"\t\tvar exports = module.exports;",
	'\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
	body,
	"\t\treturn module.exports;",
	"\t}",
	"});",
].join("\n");
await writeFile("lib/client.js", wrapped, "utf8");
await rm(clientBundle, { force: true });

// ---------- client d.ts ----------
await mkdir("lib/types/client", { recursive: true });
const dts = [
	'export declare const inject: string[];',
	'export declare function apply(ctx: import("@deepseek-ai/dsh-client-runtime/client").ClientContext): void;',
	"/** The conversation.view tab component. */",
	'export declare const Live2DView: (props: import("@deepseek-ai/dsh-client-ui-conversation/client").ConvViewProps) => import("react").ReactElement;',
	"export {};",
	"",
].join("\n");
await writeFile("lib/types/client/index.d.ts", dts, "utf8");

console.log("build complete: lib/index.js + lib/client.js");
