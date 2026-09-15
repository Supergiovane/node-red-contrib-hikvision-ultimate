# Node-RED helper scripts

This folder contains lightweight settings to bootstrap a local Node-RED runtime for development.

## Prerequisites

- Node.js `>=20.18.1`
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

## ANPR testing helpers

Two helper scripts are available for testing the ANPR config node and `picName` handling:

| Command | Description |
| ------- | ----------- |
| `npm run test:anpr-picname` | Runs a small unit test that parses sample ANPR XML and verifies `picName` stays a precise string and round-trips through `BigInt`. |
| `npm run mock:anpr-server` | Starts a mock HTTP server that emulates a Hikvision ANPR camera at `http://localhost:18080/ISAPI/Traffic/channels/1/vehicleDetect/plates`. |

When the mock server is running, configure your `ANPR-config` node with:

- `protocol`: `http`
- `host`: `127.0.0.1` (or `localhost`)
- `port`: `18080`

The mock returns lists of plates with `picName` values in random order; `ANPR-config.js` will sort them using `picName` before emitting messages to the `hikvisionUltimateANPR` node.

## Alarm discovery and connection tests

Run `npm test` for all regression tests. They use local HTTP servers, simulated failures and isolated Node-RED/clock stubs; they do not connect to a configured camera or load production flows.

| Command | Coverage |
| ------- | -------- |
| `npm run test:http-client` | Basic/Digest, supported hash algorithms, nonce renewal, challenge socket reuse, stalled headers/TLS/body, abort, truncation, response limits and cleanup. |
| `npm run test:alert-stream` | Fragmented multipart/XML/JSON, UTF-8, immediate delivery, image integrity, single dispatch, malformed/truncated frames and bounded buffers. |
| `npm run test:connection` | Config lifecycle, disconnect/reconnect, heartbeat, deploy during startup/handshake/backoff, editor routes and custom ports. |
| `npm run test:connection-health` | Silent HTTP 200 responses, malformed streams, error thresholds, confirmed recovery, XML batches and late subscribers. |
| `npm run test:alarm-capabilities` | XML/JSON capabilities, per-channel scope, cache/refresh, concurrent requests, offline fallback, authentication cooldown, cancellation and passive learning limits. |
| `npm run test:alarm-metadata` | Configured channel/region/rule names, XML text, NVR fallback, event/channel/scene scope, cache/refresh, shared cooldown, passive learning and close/timeout behavior. |
| `npm run test:alarm-runtime` | Alarm state transitions, missing/unknown states, CID timer isolation, channel/region filters, all 13 documented alias groups in both directions (including duration events), old catalog ID compatibility, thermal aliases, distinct-event isolation, malformed events and close cleanup. |
| `npm run test:alarm-editor` | Saved/custom selections, recognition suggestions delegated to Intelligent Event, one choice per alias group, casing and alias lists, old catalog ID compatibility, real dual-channel capability fixtures, late AJAX responses, switching servers/channels, editor close, discovery-only choices and CID compatibility. |
| `npm run test:config-editor` | Device-info POST requests, button recovery, safe text rendering, credentials and obsolete/aborted responses. |
| `npm run test:device-status` | Complete DeviceInfo reads, Basic/Digest/session authentication, invalid and oversized content, HTTP errors, total deadlines, cancellation, device selection, independent availability states, cooldowns, request concurrency, partial deploys and editor config references. |

### Connection behavior

- A config node owns one alert stream. Discovery and generic ISAPI requests use separate agents. Closing/redeploying cancels pending requests, reconnect timers and the stream, and destroys its agents.
- Connection setup has a 15-second header/handshake timeout per HTTP exchange. The Digest challenge body also has a deadline. The stream watchdog expects activity within 40 seconds (or the configured stream timeout if shorter). Recovery is confirmed by valid event/heartbeat data, not merely HTTP 200 headers.
- Reconnect delays increase from 2 seconds up to 30 seconds. Connection failures are reported on the existing second output after the configured disconnection limit (default: two consecutive failures); valid data resets the failure counter. A transport failure never synthesizes an alarm reset on the first output.
- Multipart parts are limited to 8 MiB, XML events to 512 KiB, and headers to 64 KiB. Limits apply to incomplete frames, not the total size of a batch of valid events. Framing errors trigger reconnect. Valid events with old timestamps or equal timestamps are preserved, including different regions; the decoder does not deduplicate camera retransmissions.
- Existing support for self-signed camera certificates remains in place. This change does not add certificate identity verification.

### Discovery behavior

Discovery reads system/event/smart capabilities, all-channel event capabilities where available, input channel lists as fallback, and the selected channel's event capabilities. It does not scan every possible channel or configure detection rules. Response bodies are capped at 2 MiB; each read has a four-second deadline. Unsupported or partial endpoints do not affect alarm delivery. Capability parsing preserves XML option attributes and uses explicit mappings for documented event flags, rather than interpreting every feature flag as an alarm.

Each config has a shared five-minute cache and serializes discovery requests. Failed queries have a 30-second retry interval; HTTP 401/403/429/503 applies a device-wide cooldown. Previously discovered data is retained on failures and shown with a partial/cached status. At most 1,024 observed event/channel combinations and 128 channel query records are retained in memory. Nothing is persisted across a config redeploy.

Name discovery uses a separate bounded queue and five-minute cache. The editor starts it after capabilities finish. Both services share the authentication/busy-device cooldown. Channel names come from `/ISAPI/System/Video/inputs/channels`, with `/ISAPI/ContentMgmt/InputProxy/channels` used only when needed for missing channels. Streaming IDs such as 101 are not converted into camera IDs.

For intrusion, line crossing, region entrance and region exit, Intelligent capabilities select `/ISAPI/Intelligent/channels/<id>/behaviorRule/1` when supported; otherwise the corresponding legacy Smart configuration is read. Temperature measurement, TMA and TMPA use `/ISAPI/Thermal/channels/<id>/thermometry/1`; temperature-difference events remain distinct. Scene IDs are included in labels. Scene 1 is a bounded, explicit scope, not a claim about the active scene; there is no scene filtering or implicit offset between rule and region IDs. See Hikvision's [Intelligent schema](https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E5%BC%82%E5%B8%B8%E8%A1%8C%E4%B8%BA%E8%AF%86%E5%88%AB.html) and [Thermal schema](https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E7%83%AD%E6%88%90%E5%83%8F%E5%8A%9F%E8%83%BD.html). Rule names are configuration data, not proof that a rule is enabled or that a particular firmware reports the matching `regionID`. Missing names, multi-channel ambiguity and unsupported endpoints preserve numeric selections.

### Verification on hardware

The automated suite cannot establish which endpoints and event variants a particular camera firmware implements. Before replacing an alarm installation's running version, verify on a separate test flow with the same model/firmware: supported-event discovery, active/inactive events on the intended channels/regions, thermal events if used, cable disconnect/reconnect, camera reboot, invalid credentials, and redeploy while connected. Confirm the second output reports failure/recovery and the first output never reports a synthetic reset. Keep the previous package version and exported flows available for rollback.
