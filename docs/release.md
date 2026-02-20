# Release Process

This repo releases three artifacts together:

1. npm CLI package: `@agent-wechat/cli`
2. npm OpenClaw extension: `@agent-wechat/wechat`
3. Docker image: `ghcr.io/thisnick/agent-wechat`

## Prepare A Release

1. Add changelog entries:

```bash
pnpm changeset
```

2. Commit the generated changeset file with your code.

3. Merge to main. The changesets GitHub Action opens a "Version Packages" PR with bumped versions and changelogs.

4. Merge the Version Packages PR to publish.

## What CI/CD Does

On merge of the Version Packages PR:

- Publishes `@agent-wechat/cli` and `@agent-wechat/wechat` to npm with provenance.
- Builds and pushes `amd64` and `arm64` Docker images.
- Publishes a multi-arch manifest tag.

Docker tags:

- `<version>` (e.g., `0.2.0`)
- `latest`

## Trusted Publishing

Configure npm trusted publishers for both packages to this repo/workflow.

No npm access token is required once trusted publishing is configured.

If you need a different GHCR path, update the image name in `.github/workflows/release.yml`.
