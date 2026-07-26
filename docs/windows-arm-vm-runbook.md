# Windows 11 ARM VM runbook

Status: selected for the first client
Host: Apple M4 Mac mini, 16 GB RAM
VM: Parallels Desktop trial with Windows 11 ARM

This is an experimental compatibility path. Windows 11 ARM can emulate x86 and
x64 Windows applications, and community reports indicate that FFXI and Ashita
can work under Parallels, but neither Square Enix nor Ashita documents this
exact Apple Silicon combination as a supported FFXI configuration.

Do not use a private-server "full client," portable game archive, torrent, DAT
pack, or installer that silently supplies Square Enix files. Some private
communities bundle Ashita, a loader, and a version-locked copy of FFXI for
convenience. That convenience does not establish permission to redistribute
the client.

## 1. Create the VM

1. Install Parallels Desktop from the official vendor distribution.
2. Start the 14-day trial without adding payment information.
3. Let Parallels download and install Windows 11 ARM from Microsoft.
4. Before installing applications, configure:
   - 4 virtual CPUs;
   - 6 GB RAM;
   - dynamically expanding disk with a 64 GB maximum;
   - Shared Network for the first test;
   - no shared Mac home folders;
   - no automatic cloud-folder sharing.
5. Install Parallels Tools and all Windows updates.
6. Do not purchase Parallels or Windows until the FFXI/Ashita compatibility
   checkpoint below passes.

The host currently has limited free disk space. Do not create snapshots or
clone the VM until the first client is working.

## 2. Install a clean FFXI client

Download the Windows client only from Square Enix:

<https://www.playonline.com/ff11us/download/media/install_win.html>

The client installer itself is available without a registration code. A retail
service registration is separate from downloading and installing the client.
Use the North American installer unless the operator's intended client region
requires another official regional build.

1. Download every part into the same folder.
2. Run the first executable to extract the installer.
3. Run `FFXISetup.exe`.
4. Install DirectX, PlayOnline Viewer, and FINAL FANTASY XI.
5. Enable Windows **Legacy Components > DirectPlay** if the installer does not
   enable it.
6. Install the current Microsoft Visual C++ 2015-2022 redistributable.
7. Launch the official FFXI configuration utility once and select conservative
   windowed graphics settings.
8. Update the client through an official Square Enix path before introducing a
   private-server loader.

Never copy Square Enix credentials, registration codes, client files, or DAT
assets into this repository.

## 3. Compatibility checkpoint

Stop and reassess the VM choice unless all of these pass:

- PlayOnline Viewer opens without missing or flickering text.
- The FFXI configuration utility opens and saves settings.
- The current FFXI client reaches its normal launch point.
- Direct3D rendering works in a window at a conservative resolution.
- The client remains stable for ten minutes.

If the base client fails, do not add Ashita or graphics wrappers yet. Record the
failure and decide between Parallels troubleshooting and a native x64 Windows
host.

## 4. Add the private-server loader

After the base client passes:

1. Use the current `xiloader` procedure documented by LandSandBoat.
2. Point it only at this private LandSandBoat instance.
3. Connect once without Ashita.
4. Confirm login and zone entry.

The Mac server remains bound to loopback because Docker runs inside Colima and
cannot directly publish ports on Parallels' host adapter. Configure the
advertised zone address and bounded Mac-side TCP/UDP forwarder instead:

```sh
./scripts/server.sh set-client-address 10.211.55.2 --yes --allow-registration
pnpm forwarder
```

For the first VM, Parallels' Shared Network addresses were verified as:

- Mac host adapter: `10.211.55.2`
- Windows guest: `10.211.55.3`

The forwarder refuses wildcard, public, and non-RFC1918 listen addresses. It
listens only on the configured private host address and forwards only the five
required TCP/UDP port combinations to Docker's loopback publications. The HTTP
telemetry API and MariaDB are not forwarded.

Validate reachability from Windows with:

```powershell
Test-NetConnection <mac-parallels-address> -Port 54001
```

## 5. Add Ashita and AgentBridge

After a loader-only connection passes:

1. Install Ashita v4 in `C:\Ashita`, separate from the game directory.
2. Configure its boot profile for the private-server loader.
3. Launch FFXI through Ashita with no optional addons.
4. Add only `AgentBridge`.
5. Copy the protected bridge configuration without displaying or logging its
   token.
6. Establish the loopback tunnel described in
   [client-runbook.md](client-runbook.md).
7. Run `pnpm doctor`, then follow the closed-loop validation list.

Ashita's `Sandbox` feature can make an existing working client portable, but
Ashita explicitly requires a working copy of the game first. It is not a source
for obtaining FFXI.

## 6. Purchase checkpoint

Only after FFXI, `xiloader`, Ashita, and AgentBridge all work:

- decide whether to license Parallels after the trial;
- activate Windows 11 if a license is required for continued use;
- create one clean VM snapshot;
- document the exact working versions;
- consider a second isolated VM/client only after measuring host memory use.
