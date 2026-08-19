# Contributing

Thanks for helping improve Gridline.

## Development setup

Install Node.js 20 or newer, pnpm 10.24, stable Rust, and wasm-pack 0.15. Then:

~~~bash
pnpm install
pnpm build:wasm
pnpm dev
~~~

The demo runs at http://127.0.0.1:3000 and uses Next.js Webpack.

## Before submitting a change

Run the same checks as CI:

~~~bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm pack:check
~~~

Keep workbook parsing bounded and local. New OOXML collections, recursive
formula behavior, downloads, cloud fetch options, and main-thread layout loops
must include explicit resource and trust-boundary tests.

Use focused commits with descriptive messages. Public contributions should not
include proprietary workbooks, credentials, customer data, or generated
wasm-pack output.
