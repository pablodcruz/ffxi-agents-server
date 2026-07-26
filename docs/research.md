# Research findings

Date checked: 2026-07-25

## What is and is not open source

[LandSandBoat](https://github.com/LandSandBoat/server) is an actively maintained
GPLv3 FFXI server emulator. It is not the FFXI client and does not make FFXI
itself open source.

LandSandBoat's
[client setup guide](https://github.com/LandSandBoat/server/wiki/Client-Setup-Windows)
says the client must be installed on Windows, updated after connecting to retail
through an authorized method, and pointed at a private server with a current
`xiloader`. The guide explicitly says the project does not condone client-update
bypasses. Ashita and Windower are optional launch/addon layers after a plain
`xiloader` connection works.

## Server deployment

LandSandBoat publishes official multi-architecture container images:

- `ghcr.io/landsandboat/server:latest`
- `ghcr.io/landsandboat/ximeshes:latest`

The current server image manifest includes `linux/arm64`, but live inspection
on an aarch64 Colima daemon showed its processes executing through
`qemu-x86_64`; it must not be described as native on this tested image. The
current ximeshes image is also amd64-only, but it is a one-shot seed container
and completed successfully under Docker architecture emulation. Performance
was sufficient for this local prototype (the 300-zone map process initialized
in 66 seconds), but a future public host should be x86-64 unless a genuinely
native image is verified. The server image contains the compiled services,
scripts, SQL, and tools, but not MariaDB or navigation/collision meshes.

The current upstream
[Docker README](https://github.com/LandSandBoat/server/blob/base/docker/README.md)
defines four services (`xi_connect`, `xi_search`, `xi_world`, and `xi_map`), a
MariaDB database update job, and the required client ports. This repository's
`compose.yaml` follows that layout while using local-only port bindings.

Live validation found one mismatch in that README: current `xi_map` also
requires the image's `/ximeshes` data, while the example mounts only
`/navmeshes`. The current server can also generate navmesh files absent from
the mesh image, so the navmesh volume must remain writable while the source
ximeshes volume can be read-only. This stack applies both corrections.

The exact server, ximeshes, and MariaDB image digests exercised by this
prototype are pinned in `.env.example` and `compose.yaml`. A live backup was
restored into an isolated disposable MariaDB container; both databases reported
125 `xidb` tables and zero accounts.

LandSandBoat's
[post-install guide](https://github.com/LandSandBoat/server/wiki/Post-Install-Guide)
requires `zone_settings.zoneip` to be set to the address clients can reach. That
database change is intentionally deferred until we know where the Windows
client will run.

## Agent observations and actions

LandSandBoat has an optional built-in HTTP API. Inspection of
`src/world/http_server.cpp` shows these read-only endpoints:

- `/api`
- `/api/sessions`
- `/api/ips`
- `/api/zones`
- `/api/zones/{id}`
- `/api/settings`

They update from the database and do not control a player.

[Ashita v4](https://github.com/AshitaXI/Ashita-v4beta) is a more suitable client
bridge. Its public addon SDK exposes:

- player, party, target, entity, inventory, and recast memory interfaces;
- entity names, positions, headings, distances, HP, status, and target selection;
- incoming chat and packet events;
- a supported `QueueCommand` method;
- bundled LuaSocket and JSON libraries.

Ashita's official [feature documentation](https://docs.ashitaxi.com/features/)
also documents hooked input injection and wrapped client memory interfaces.
For the first movement primitive, this prototype uses the SDK's `IAutoFollow`
getters/setters rather than raw offsets, packet injection, coordinate warps, or
unbounded keyboard input.

That is sufficient for a structured first agent loop without relying on screen
coordinates. Computer use remains useful for login, character creation,
cutscenes, menus, and visual verification, but should not be the primary
real-time control channel.

## Why not a headless FFXI bot client

No current, maintained, general-purpose headless FFXI client was identified in
the primary sources reviewed. Implementing the retail network protocol would be
a much larger reverse-engineering project, would lose important client/UI state,
and would increase compatibility and legal risk. A real client plus a narrow
local addon bridge is the shortest testable path.

## Contractual and legal risk

This is the major constraint for any public launch.

Square Enix's current
[FFXI User Agreement](https://support.na.square-enix.com/rule.php?id=20&la=1&tag=ff11user)
prohibits bots, unauthorized gameplay software, private servers, data mining,
and modification/reverse engineering of the game. Its
[third-party program policy](https://support.na.square-enix.com/faqarticle.php?id=20&kid=12800)
also prohibits automation and unofficial programs within PlayOnline services.

Therefore:

- Keeping the agent off retail avoids harming retail players and avoids risking
  a live retail character, but it does **not** make the private-server/client
  setup authorized by Square Enix's agreement.
- LandSandBoat being GPLv3 does not grant rights to the proprietary client,
  assets, trademarks, or service.
- A public server materially increases exposure and should not proceed without
  the operator accepting the contractual risk and, if this is more than a
  personal experiment, obtaining qualified legal advice.
- This repository must never redistribute client binaries, DAT assets, Square
  Enix credentials, or branded assets.

This is a technical assessment, not legal advice.

## MCP and Codex

Current Codex documentation supports local stdio and remote Streamable HTTP MCP
servers, project-scoped `.codex/config.toml`, server instructions, tool
allow/deny lists, and write-oriented approval modes. A local stdio server is the
smallest and safest fit for the prototype.

The implementation pins the stable v1 MCP TypeScript SDK. The official SDK
currently describes v2 as pre-alpha and recommends v1 for production until the
v2 release.
