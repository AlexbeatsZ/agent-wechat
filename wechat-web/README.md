# agent-wechat Web

The Web stack stays separate from the Rust core:

- Rust agent-server API: `http://localhost:6174`
- Web UI and BFF: `http://localhost:3001`
- `wechat-web/deploy_server.py` adapts Web routes to the agent-server API.
- `wechat-web/apps/web` builds the static frontend served by the BFF.

## Development Deploys

```bash
pnpm dev
```

Starts the agent-server development container only. In this mode `docker/tools` is live-mounted into `/opt/tools`, so tool changes are visible without an extra sync.

```bash
pnpm dev:deploy
```

Rebuilds and deploys only the Rust backend binary into a running agent-server container.

```bash
pnpm dev:deploy -- --sync-tools
```

Also copies `docker/tools` into a non-dev container. Use this when the container was not started by `pnpm dev`, or rebuild the image instead.

```bash
pnpm dev:deploy:web
```

Builds `wechat-web/apps/web`, builds the lightweight Web/BFF Docker image, and restarts the Web container.

```bash
pnpm dev:deploy:all --sync-tools
```

Deploys the Rust backend, syncs tools, deploys Web, and checks both health endpoints.

## Change Rules

- Changes under `packages/agent-server-rust` need `pnpm dev:deploy`.
- Changes under `docker/tools` are live-mounted only for `pnpm dev` containers; non-dev containers need `--sync-tools` or an image rebuild.
- Changes under `wechat-web/apps/web/src` need `pnpm dev:deploy:web` or `pnpm dev:deploy:all`.
