# Node-RED helper scripts

This folder contains lightweight settings to bootstrap a local Node-RED runtime for development.

## Prerequisites

- Node.js `>=16`
- Node-RED available via `npx node-red` (or globally installed)

## Available scripts

| Command | Description |
| ------- | ----------- |
| `npm run node-red:noauth` | Launch Node-RED without authentication. Ideal for quick testing. |
| `npm run node-red:auth` | Launch Node-RED with admin + HTTP endpoint protection enabled. Defaults to `admin` / `admin` (override via env vars). |

Both profiles:

- Use `~/.node-red` as the user directory unless `NODE_RED_USER_DIR` is set.
- Load the flow specified by `NODE_RED_FLOW_FILE` (default `flows.json`). Example: `NODE_RED_FLOW_FILE=hik npm run node-red:auth`.
- Reuse the credential secret stored in `~/.node-red/.config.runtime.json`. To force a specific secret, export `NODE_RED_CREDENTIAL_SECRET` beforehand.

## Environment variables

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `NODE_RED_FLOW_FILE` | Flow file name (without extension changes) | `flows.json` |
| `NODE_RED_USER_DIR` | Alternate Node-RED user directory | `~/.node-red` |
| `NODE_RED_CREDENTIAL_SECRET` | Credential encryption key | auto-detected / dev fallback |
| `NODE_RED_ADMIN_USER` | Admin username (`auth` profile) | `admin` |
| `NODE_RED_ADMIN_PASS_HASH` | Bcrypt hash for admin password | pre-baked hash for `admin` |
| `NODE_RED_HTTP_USER` | HTTP endpoint username (`auth` profile) | `admin` |
| `NODE_RED_HTTP_PASS_HASH` | Bcrypt hash for HTTP auth | matches admin hash |

Generate a new hash with `npx node-red admin hash-pw`. Export the hash before running the script to use your own credentials.

## Examples

```bash
# No authentication, load the flow "hik"
NODE_RED_FLOW_FILE=hik npm run node-red:noauth

# Authentication enabled, custom admin password and credential secret
NODE_RED_FLOW_FILE=hik \
NODE_RED_ADMIN_PASS_HASH="<bcrypt-hash>" \
NODE_RED_CREDENTIAL_SECRET="my-secret" \
npm run node-red:auth
```

These profiles are for development only. Never deploy them in production with the default credentials.
