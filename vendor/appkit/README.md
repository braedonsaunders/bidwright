# AppKit distribution

Bidwright consumes the same compiled AppKit packages as the sibling products.
The tarballs in this directory are packed from the adjacent `appkit`
repository after its package checks pass.

Current packages:

- `@appkit/tokens` `0.1.1`
- `@appkit/ui` `0.1.8`
- `@appkit/dashboard` `1.0.2`
- `@appkit/iam` `1.0.0`
- `@appkit/crypto` `0.3.0`
- `@appkit/process-sandbox` `0.1.2`

The root pnpm override intentionally resolves `@appkit/ui`'s token dependency
to the vendored token tarball. Server packages consume the vendored crypto and
process-sandbox artifacts directly. This keeps installs reproducible without
depending on unpublished registry packages.

When AppKit changes, rebuild and validate the affected packages first, replace
their tarballs together, refresh the Bidwright lockfile, and run the relevant
server/web typechecks and production builds.
