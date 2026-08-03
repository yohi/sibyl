import babel from "@rollup/plugin-babel";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const extensions = [".ts", ".tsx"];
const external = [/^@opencode-ai/, /^@opentui/, /^solid-js(?:\/|$)/, "node-pty"];

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.js", format: "esm", inlineDynamicImports: true },
    external,
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/server.ts",
    output: { file: "dist/server.js", format: "esm", inlineDynamicImports: true },
    external,
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/tui.tsx",
    output: { file: "dist/tui.js", format: "esm", inlineDynamicImports: true },
    external,
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
];
