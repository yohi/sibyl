import { nodeResolve } from "@rollup/plugin-node-resolve"
import babel from "@rollup/plugin-babel"

const extensions = [".ts", ".tsx"]

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/server.ts",
    output: { file: "dist/server.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/tui.tsx",
    output: { file: "dist/tui.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
]
