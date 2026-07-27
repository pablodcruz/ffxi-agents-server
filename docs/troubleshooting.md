# Troubleshooting the tested Mac + Parallels setup

Status: validated end to end on 2026-07-26

This guide records failures encountered while bringing one Windows 11 ARM
client into a local LandSandBoat server on an Apple Silicon Mac. It applies to
the topology in [windows-arm-vm-runbook.md](windows-arm-vm-runbook.md):

```text
Windows 11 ARM in Parallels                  Apple Silicon Mac
FFXI + xiloader + Ashita + AgentBridge  ->  private port forwarder
                                             -> Colima -> LandSandBoat
AgentBridge 127.0.0.1:19769             <-  restricted SSH reverse tunnel
```

Do not use this guide to connect automation to retail FFXI. Do not put client
files, DATs, passwords, registration codes, bridge tokens, or screenshots of
credentials in an issue or commit.

## Known-good checkpoint

The first validated vertical slice used:

- Windows 11 ARM in a Parallels Shared Network VM;
- an authorized, fully updated Square Enix FFXI installation;
- LandSandBoat xiloader 2.1.2;
- Ashita 4.3.1.2;
- Colima 0.10.3 with `portForwarder: grpc`;
- the pinned container digests in this repository;
- character `Pablo`, Hume male, Monk level 1, in Bastok Markets;
- AgentBridge through a restricted SSH tunnel on Mac loopback port 19769;
- 12 MCP tools discovered, live observation working, and the control latch
  successfully armed and emergency-stopped without moving the character.

The exact VM addresses were `10.211.55.2` for the Mac host and `10.211.55.3`
for Windows. Treat those as examples: verify the addresses assigned to your
own Parallels network.

## Start with this diagnostic ladder

Run these on the Mac before opening xiloader:

```sh
colima status
./scripts/server.sh status
./scripts/server.sh check
pnpm test
pnpm forwarder
```

`server.sh check` must end with:

```text
Map process completed zone initialization.
```

On macOS, confirm that two different processes own the two UDP hops:

```sh
lsof -nP -iUDP:54230
```

Expected shape:

```text
limactl ... UDP 127.0.0.1:54230
node    ... UDP <MAC_PARALLELS_IP>:54230
```

If the `limactl` line is absent, do not launch FFXI. Fix Colima UDP forwarding
first. If the `node` line is absent, start `pnpm forwarder` and keep it running.

After FFXI is in the world:

```sh
pnpm doctor -- --bridge-only
pnpm mcp:smoke
pnpm mcp:control-smoke
pnpm mcp:gameplay-smoke -- --target <EXACT_NEARBY_NPC_NAME>
```

The control smoke test does not move the character or issue a gameplay command.
It arms the write latch, verifies the enabled state, and always calls the
emergency stop. The gameplay smoke test adds one exact nearby target and
`/check <t>`, stops movement defensively, and also always calls the emergency
stop.

## Symptom guide

### `FFXI-3001` after selecting a character

Meaning: the lobby handed the character to the map server, but the UDP map
session did not complete.

Check the server logs:

```sh
docker-compose logs --no-color --since 5m connect map
```

A healthy sequence includes:

```text
data_session: zoneid: 235, zoneipp: <MAC_PARALLELS_IP>:54230
Creating pending session for character id 1
Creating session for 172.18.0.1
Player <Pablo> logging in to zone <235>
IncreaseZoneCounter <1> Pablo
```

Check the private forwarder. A healthy sequence includes:

```text
UDP peer <WINDOWS_IP>:<EPHEMERAL_PORT> forwarding to 127.0.0.1:54230.
UDP reply path active ... from 127.0.0.1:54230.
```

The failure on the reference Mac was Colima's default `ssh` port forwarder.
That mode carries TCP only. Docker still displayed a UDP publication, but no
macOS process owned `127.0.0.1:54230/UDP`. Preserve the existing volumes and
change only the Colima forwarding mode:

```sh
colima stop
colima start --port-forwarder grpc
./scripts/server.sh up
./scripts/server.sh check
```

`grpc` supports both TCP and UDP. The setting persists in the Colima profile.
The repository's host forwarder now refuses to start on macOS when the
loopback UDP target has no listener.

There is also a smaller startup race under x86 emulation: the client may send
its only first map datagram before LandSandBoat creates the pending session.
The host forwarder retries only that first datagram once after one second,
unless it has already received a reply or another client datagram.

### `Bad JSON reply from remote`

This came from two different stale-connection cases:

1. The original private forwarder closed idle TCP connections after two
   minutes while a person was still at an account or password prompt. The
   timeout is now 15 minutes.
2. Restarting `pnpm forwarder` while xiloader is open invalidates xiloader's
   existing TLS session. Exit xiloader completely and launch a new Ashita
   session after the forwarder is stable.

Do not keep submitting credentials to a loader process whose underlying
forwarder was restarted.

### `FFXI-3101` transmission error with lobby server

This is expected if the private forwarder or Colima is restarted while the
lobby is open. Close the game client, wait for `server.sh check` and
`pnpm forwarder`, then relaunch from a clean xiloader process.

### `FFXI-3117` failed to carry out user file operations

The official installation under `Program Files (x86)` may leave the FFXI
`USER` directory non-writable to a normal process. On the reference VM, plain
xiloader reached this error while the elevated Ashita launch worked.

Use a narrowly scoped elevated launcher or scheduled task for the known Ashita
profile. Do not make the whole Square Enix installation writable to all users,
and do not disable Windows security features as a workaround.

The reference task is named `AshitaAgentLab`. Inspect its action and run level
before reusing that name on another machine.

### Character creation freezes or shows UI with no character graphics

On Windows 11 ARM, the normal race/gender renderer repeatedly stalled. In the
official FFXI configuration utility:

1. enable **Legacy Settings**;
2. enable **Simplify character selection screen graphics**;
3. use a conservative windowed resolution;
4. save the configuration and relaunch the client.

Do not diagnose this as a server failure: the server has not received a
character until xiloader logs the successful creation.

### The multipart installer cannot find installation packages

Use only Square Enix's official multipart download. Put every downloaded part
in the same directory, run the first executable to extract the set, and then
run `FFXISetup.exe` from the extracted directory. A missing part or moving
files between extraction and setup produces package-not-found messages.

Do not substitute a private-server full-client archive or bundled DAT pack.

### The login ID or password appears wrong

Three credential systems can appear during setup:

- the Square Enix account used for official registration and updates;
- the PlayOnline ID/password associated with the authorized retail service;
- the separate LandSandBoat account created through xiloader.

The private server login uses only the LandSandBoat credentials. Never reuse a
Square Enix, PlayOnline, email, Windows, or GitHub password for it. The
repository does not store any of these credentials.

### AgentBridge is unreachable

Check in this order:

1. Ashita loaded `agentbridge` and reported loopback address
   `127.0.0.1:19769`.
2. The protected `config.json` exists beside the addon and is not readable by
   unrelated Windows users.
3. The restricted SSH tunnel task is running.
4. The Mac owns `127.0.0.1:19769`.
5. `pnpm doctor -- --bridge-only` reports writes disabled and movement
   inactive.

Do not open AgentBridge's port in Windows Firewall or bind it to a LAN address.

### Safely transferring the initial Ashita files

Prefer an authenticated file-transfer method when one is already available.
For a fresh private VM, `scripts/serve-client-bootstrap.mjs` can temporarily
serve the exact Ashita profile, startup script, addon, and generated bridge
configuration needed by the expected Windows peer.

The bridge configuration contains a bearer token. The helper therefore:

- binds to the Mac's Parallels address rather than all interfaces;
- rejects clients other than `FFXI_BOOTSTRAP_PEER`;
- serves each path only once with `Cache-Control: no-store`;
- exits after all four files are retrieved or after five minutes.

Use it only on an isolated Parallels Shared Network with OBS and other screen
capture stopped. Never bind it to a LAN, public, or wildcard address. Confirm
that it exits after the transfer, delete transient browser/download history in
the VM as appropriate, and rotate the bridge token if the network or recording
boundary may have been exposed.

### MCP tools do not appear in an existing Codex task

The project-scoped MCP entry is in `.codex/config.toml`. Restart the Codex task
after the initial dependency install or an MCP configuration change. Until
then, the protocol can be tested directly with:

```sh
pnpm mcp:smoke
```

This is a task tool-registry refresh issue, not an AgentBridge failure, when
the direct smoke test succeeds.

### The map process restarts during startup

The tested LandSandBoat image executes x86-64 code through QEMU on this
aarch64 Colima VM. A slow all-zone load can trigger the map inactivity
watchdog. Upstream defaults to two seconds. This repository keeps the watchdog
enabled but raises its period to 30 seconds through
`XI_MAIN_INACTIVITY_WATCHDOG_PERIOD`. Override the local default with
`LSB_WATCHDOG_PERIOD_MS` only after reviewing map logs. Compose restarts the
service, but process liveness alone does not mean all zones are ready.

Always wait for:

```sh
./scripts/server.sh check
```

For multiple players or long-running hosting, use a real x86-64 Linux host
unless a genuinely native and tested server image becomes available.

### FFXI-4001 appears during live play

Inspect the map logs before blaming the forwarder:

```sh
docker logs --since 10m ffxi-agent-lab-map-1
./scripts/server.sh check
```

On the reference Apple Silicon setup, `xi_map` repeatedly exceeded its
upstream two-second inactivity watchdog while running under x86 QEMU
emulation. The watchdog terminated the process, Compose restarted it, and the
client later displayed `FFXI-4001: No response from the FINAL FANTASY XI
server`. A subsequent `FFXI-3101` can appear while the old lobby session is
being torn down.

Recreate the map service after pulling a repository revision that includes the
QEMU-safe watchdog period:

```sh
docker compose up --detach --no-deps --force-recreate map
./scripts/server.sh check
```

Confirm the new container log contains:

```text
Applying ENV VAR XI_MAIN_INACTIVITY_WATCHDOG_PERIOD
```

Wait for `Map process completed zone initialization`, dismiss the client error,
and relaunch the saved Ashita profile. Character position is persisted by the
server. This failure is independent of host-side navmesh queries, which read an
ignored copy of the mesh and do not call the live map process.

### OBS shows a frozen FFXI frame but MCP observations still change

FFXI can pause rendering when the guest game window loses focus. The clearest
signal is an unchanged in-game clock while MCP positions continue to update.
Focus the FFXI window inside Parallels; the renderer and OBS capture should
resume immediately.

For audio, do not trust the presence of an OBS audio track or an apparently
active mixer alone. In the tested OBS 32.0.4 setup, the `macOS Screen Capture`
source produced stereo AAC but every decoded sample was digital silence
(`-91.0 dB` peak and mean).

The verified repair is:

1. grant OBS **Screen & System Audio Recording** permission in macOS;
2. keep the Parallels `macOS Screen Capture` source for video;
3. enable **Show fullscreen and hidden windows / applications** and reselect
   `[Parallels Desktop] Windows 11` after putting the VM in full screen;
4. add a separate **macOS Audio Capture** source using **Desktop Audio
   Capture**;
5. keep both sources unmuted and on stream/recording track 1; and
6. record a local Windows notification before going live.

The final successful local test was 1920x1080 H.264 at approximately 6 Mbps
with 48 kHz stereo AAC at 160 kbps. Decoding the recording with `ffmpeg` and
`volumedetect` measured `-37.5 dB` mean and `-9.8 dB` peak, proving the track
was no longer silent.
OBS microphone permission is not required for this path, and no microphone
source should be added unless the operator explicitly wants one on stream.

OBS 32.0.4 exited uncleanly twice while creating the macOS Audio Capture source
and applying its first output changes. Relaunching in **Normal Mode** preserved
the source and settings. Keep streaming stopped while changing sources, and do
not consent to uploading a crash report unless the operator has reviewed it.

### xiloader prints `Closing...` immediately after FFXI starts

The tested Windows 11 ARM client can initialize Ashita and Direct3D, then
unload the game less than one second later without producing a Windows crash
event. The diagnostic sequence looks like this:

```text
Successfully logged in as <redacted>!
Connected to server!
Resolving host: <WINDOWS_HOSTNAME>
Closing...
```

`Resolving host: <WINDOWS_HOSTNAME>` is normal. xiloader is resolving the
client machine's own address before calling FFXI; it is not reporting failed
DNS. In the matching Ashita log, `GameLoaded` completes, the Direct3D and input
devices are created, and `GameUnloaded` follows immediately.

On the tested Parallels ARM VM, the trigger was the manually increased
2560x1440 background render buffer. The display itself can remain borderless
2560x1440, but restoring the official High preset's 1024x576 background buffer
made the client stable again:

| Value | Stable ARM VM value |
| --- | --- |
| `0001` / `0002` | `0xa00` / `0x5a0` (2560x1440 display) |
| `0003` / `0004` | `0x400` / `0x240` (1024x576 background render) |
| `0034` | `0x3` (borderless) |
| `0037` / `0038` | `0x900` / `0x510` (2304x1296 UI) |

Recovery:

1. keep OBS stopped;
2. export the current FFXI registry key for rollback;
3. restore
   `C:\FFXI-Lab\backups\ffxi-graphics-before-native-render.reg`;
4. keep the Ashita profile at `autoclose = 1`;
5. gracefully restart Windows;
6. verify Parallels again reports 2560x1440; and
7. launch the saved `AshitaAgentLab` task and verify one live server session
   plus a reachable, write-disabled AgentBridge.

Setting `autoclose = 0` while launching from Task Scheduler can leave xiloader
attached to an invisible `conhost.exe`. Restore `autoclose = 1` and restart
Windows rather than repeatedly starting orphaned loader processes.

### FFXI is blurry, low resolution, or framed incorrectly in OBS

Match the guest, game, and OBS aspect ratios instead of stretching a low
resolution game window:

1. stop OBS streaming and close FFXI and PlayOnline;
2. put Parallels in full screen and verify Windows reports `2560x1440`;
3. use the official FFXI configuration utility to select **Borderless
   Window**, `2560x1440`, a `2304x1296` UI scale, and the High preset;
4. export the FFXI registry key before any manual adjustment; and
5. verify the following tested values under
   `HKLM\SOFTWARE\WOW6432Node\PlayOnlineUS\SquareEnix\FinalFantasyXI`:

| Value | Meaning | Tested setting |
| --- | --- | --- |
| `0001` / `0002` | display width / height | `0xa00` / `0x5a0` (2560x1440) |
| `0003` / `0004` | background render width / height | `0x400` / `0x240` (1024x576, stable ARM baseline) |
| `0034` | window mode | `0x3` (borderless) |
| `0037` / `0038` | UI width / height | `0x900` / `0x510` (2304x1296) |

The official High preset leaves the background buffer at 1024x576. Increasing
`0003` and `0004` to 2560x1440 produced a sharper image but later caused an
immediate, clean client unload on the tested Windows 11 ARM VM. Treat 1024x576
as the stable compatibility baseline and change the background buffer only
after exporting the key and completing a ten-minute launch/gameplay test.
After restarting Windows, verify both the 2560x1440 guest resolution and the
registry values again before launching the game. The tested OBS output is
1920x1080 at 30 FPS and 6000 kbps, with its 1920x1080 canvas preserving the
16:9 VM framing.

Do not add the Ashita console or login window to the public scene. Capture the
Parallels game window and publish sanitized MCP action summaries separately.

## Safe recovery sequence

When state is unclear, use this order:

1. Close only the failed FFXI/xiloader process.
2. Keep the database volumes; do not use `down -v`.
3. Verify Colima uses the `grpc` port forwarder.
4. Run `./scripts/server.sh up`.
5. Wait for `./scripts/server.sh check`.
6. Start `pnpm forwarder` and do not restart it during login.
7. Launch the elevated Ashita profile.
8. Enter the private-server credentials.
9. Accept FFXI's Rules & Policies yourself.
10. Select the character and watch for both the UDP reply and map-session logs.
11. Run the bridge and MCP smoke checks.

If a control test behaves unexpectedly, call `ffxi_emergency_stop` or close
the FFXI client. Writes are disabled after every addon load and every emergency
stop.

## Streaming and evidence

Keep OBS stopped or use a tightly cropped game-window source while any of these
are visible:

- Square Enix or PlayOnline IDs;
- passwords, registration codes, or one-time codes;
- xiloader account forms;
- the AgentBridge token or protected JSON;
- SSH private keys or authorization entries;
- terminal output that may include local usernames or paths.

Before going live, inspect the OBS preview and confirm that the Ashita console,
xiloader form, Windows desktop, browser, and Mac terminal are not captured.
The in-world game window is the safest streaming checkpoint.

Set YouTube metadata before starting the stream. Use a session-specific title
under the `FFXI AI Agent Lab` name and a description that identifies the
LandSandBoat/Ashita/MCP experiment, links the public repository, states that it
is a local non-commercial learning project, and says that credentials and
private launcher screens are intentionally kept off-stream. Replace default
titles such as `Clanker Site Live Stream` on archived FFXI sessions.

Useful issue evidence includes timestamps, error codes, sanitized service
logs, versions, architecture, and whether each expected listener exists.
Redact credentials, tokens, public IPs, client files, and copyrighted assets.
