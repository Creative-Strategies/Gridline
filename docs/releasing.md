# Releasing Gridline

Gridline publishes `gridline-wasm` first and `gridline-viewer` second. Both
package manifests and `crates/gridline-core/Cargo.toml` should carry the same
release version.

## One-time setup

1. Publish each package once from an npm account that owns it. The initial
   publish can disable provenance because it does not run inside GitHub Actions:

   ```bash
   npm publish ./packages/gridline-wasm --access public --provenance=false
   npm publish ./packages/gridline-react --access public --provenance=false
   ```

2. Configure an npm trusted publisher for both packages using:

   - organization or user: `Creative-Strategies`
   - repository: `Gridline`
   - workflow filename: `publish.yml`
   - environment: none

The workflow uses GitHub OIDC, so it does not require a long-lived npm token.

## Release checklist

1. Update both package versions, the Rust crate version, and `CHANGELOG.md`.
2. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
   `pnpm pack:check`.
3. Commit and push the release changes.
4. Publish a GitHub release tagged `v<version>`.
5. Confirm the `Publish npm packages` workflow completed and verify both npm
   versions with `npm view`.

The workflow validates that the tag matches the package version and safely
skips a package version that is already present. This permits recording the
initial manually published version as a GitHub release without a duplicate
publish failure.
