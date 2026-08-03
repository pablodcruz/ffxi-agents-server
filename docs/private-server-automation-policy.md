# Private-server automation and GM decision policy

Status: adopted for the local lab
Date: 2026-08-02

## Purpose

This project is trying to build a dependable agent game loop, not reproduce
every human keypress. The useful experiment is whether an agent can choose
goals, supervise durable automation, diagnose failures, and recover safely.
Repeated camera inspection, menu traversal, and one MCP call per combat action
hide that question behind latency and model-token cost.

The local LandSandBoat server therefore permits a small number of server-backed
operations. Some require GM level 1 because that is LandSandBoat's permission
boundary. GM permission is not treated as a general capability: raw GM command
text, arbitrary item or spell IDs, arbitrary quest transitions, Lua execution,
and database access are never exposed as agent tools.

This policy explains when those operations are appropriate, how narrowly they
must be designed, and what evidence is required before relying on them.

## Decision order

Choose the first practical layer in this order:

1. **Normal game mechanics** when they are deterministic and inexpensive.
   Combat commands, ordinary targeting, Trusts, learned spells, equipment, and
   working quest interactions should retain normal server validation.
2. **A local deterministic supervisor** for frequent real-time loops. Combat,
   aggro response, Trust recovery, stop conditions, and route iteration belong
   here rather than in repeated model/MCP turns.
3. **A typed native-client operation** when the game already has an exact packet
   or command but its menu adds no meaningful decision. The operation must fix
   the packet type and validate every variable field.
4. **A proximity- and state-gated server outcome** for high-friction private-lab
   interactions. It must preserve normal prerequisites and costs unless the
   operation is explicitly documented as a lab convenience.
5. **A temporary recovery helper** only after the normal implementation is
   demonstrated broken or unavailable. Its scope must be the single blocked
   state, and authoritative state must be verified afterward.

Visual computer use remains useful for login, cutscenes, and diagnosis. It is
not the preferred control plane for a repeatable loop.

## Decision criteria

An operation is justified only when its benefit is concrete across several of
these dimensions:

- **Token and call cost:** it replaces repetitive observation/action turns, not
  a meaningful player decision. The aim is to reserve model tokens for planning
  and exceptions. Token estimates are sampled occasionally for the overlay;
  combat does not poll or depend on them.
- **Latency and survival:** real-time responses such as aggro defense must run
  locally because a model round trip is too slow and inconsistent.
- **Determinism:** the intended NPC, item, quest state, zone, and result can be
  expressed exactly and tested.
- **Friction:** a menu or collision sequence is consuming substantial time but
  does not add useful gameplay to the experiment.
- **Fidelity:** normal prerequisites, currency costs, item consumption, level
  requirements, and server-side results can remain intact.
- **Observability:** success can be checked using game events plus authoritative
  player, inventory, or database state.
- **Reversibility:** temporary effects can be removed and the character can be
  returned to a safe state after failure.

Low token usage is not sufficient by itself. We do not bypass an uncertain
decision, invent rewards, or weaken a safety gate merely to save calls.

## Capability classes

### Durable low-token supervisors

The combat and NM-route supervisors own high-frequency state transitions and
write a persisted lease heartbeat and JSONL audit log. The model sets a bounded
goal, checks material progress, and intervenes only for a level transition,
death, disconnect, inventory block, stale heartbeat, or unknown error. This is
both cheaper and safer than asking the model to notice every hit or issue every
attack.

Every lease has exact zone and stop conditions, bounded duration/fights, health
and inventory gates, and a cooperative stop. Death, disconnect, missing game
process, and unknown errors require diagnosis rather than blind restart.

### Service teleport

Teleport is the current fallback while collision-aware navigation is still
being developed. It removes repeated wall collisions and camera polling, but it
is allowed only while idle and outside menus, with typed coordinates, an exact
zone, an allowlisted reason, and a hard confirmation phrase. It must not be used
to escape or change the outcome of active combat. Validated normal routes remain
valuable and should replace teleport where navigation itself is under test.

### Exact transactions and native packets

Vendor, inventory-transfer, configuration, and NPC-trade helpers fix the target
operation and validate proximity, menu state, item IDs, slots, quantities,
currency, and resulting deltas. A caller cannot choose a packet ID or construct
a payload. Where the lab deliberately grants a convenience, such as the fixed
RDM utility-spell allowlist, that cost/fidelity exception must be named rather
than implied.

### Quest helpers and temporary protections

Quest automation should normally perform the quest. A helper may encode one
exact transition only when it checks the accepted quest, expected cap or mission
state, exact zone/NPC or marker, required items, and proximity. It cannot accept
an arbitrary quest, event, reward, key item, or completion state.

Temporary quest safety exists to test broken marker interactions without losing
progress to unrelated aggro. It is explicitly enabled, re-armed after zoning,
and removed before the final normal hand-in. A marker-recovery command is an
exception of last resort: it may restore only the exact fragment whose normal
server marker was live-tested and found not to dispatch. It cannot complete the
quest or raise the level cap.

### Database access

Direct database changes are deployment and recovery tools, not the gameplay
interface. They are acceptable for initial local-only configuration, granting
the dedicated character GM level 1, repairing proven lab corruption, or
authoritatively verifying a result. Routine gameplay should use the bounded MCP,
client, or server operation so its prerequisites, audit event, and postcondition
remain visible. Every direct mutation needs an exact target, a before/after
query, and a documented reason.

## Test and verification standard

Before a new state-changing shortcut becomes routine:

1. Reproduce the friction or failure using the normal mechanic.
2. Resolve the exact server/client IDs and inspect the pinned implementation.
3. Implement the narrowest typed interface at both MCP and AgentBridge/server
   boundaries; duplicate validation so bypassing one layer is insufficient.
4. Add static or unit tests for the allowlist, confirmation phrase, proximity,
   prerequisite, parameter, and rejection paths.
5. Live-test one bounded operation on the local server.
6. Verify the postcondition through at least two useful signals: for example a
   game event plus inventory delta, or dialogue plus database state.
7. Exercise emergency stop or rollback where the operation is temporary.
8. Record the finding in the relevant runbook before expanding the allowlist.

Unknown outcomes fail closed. Do not repeat a trade, grant, sale, teleport, or
quest transition until current state is inspected; retries can duplicate or
destroy state even when the first response was lost.

## Current decisions and rationale

| Capability | Why it exists | Fidelity and safety boundary |
|---|---|---|
| Combat supervisor | Aggro and combat are too fast and repetitive for model turns | Normal targets/actions, bounded lease, health/inventory/death stops |
| NM route supervisor | Repeated camp loops are deterministic and expensive to poll | Fixed profiles, watched drops, round limits, persisted progress |
| Fishing supervisor | Camera/collision casting and the minigame are repetitive, while the server already owns the meaningful outcomes | Fixed starter zones/gear and packet modes; normal catch, bait, rod, inventory, fatigue, and skill rules; bounded skill/time/casts |
| Service teleport | Collision/pathing is not yet reliable enough for unattended routes | Idle only, typed destination/reason, never an active-combat escape |
| Private vendor transaction | Shop menus add friction but not a useful decision | Exact NPC/item, normal Sparks/gil/inventory rules, verified deltas |
| Fixed RDM utility spells | Local lab prioritized testing the RDM combat loop | Fixed named allowlist and level gates; documented exception to scroll cost |
| Inventory transfer/cleanup | Slot menus and full inventory repeatedly block durable loops | Exact accessible containers/items; no arbitrary deletion or reward grant |
| Exact Maat trade | Three-item menu trade was fragile; the quest itself was completed normally | Exact Maat ID/items/slots/proximity; event dialogue performed; cap verified |
| Quest safety | Unrelated aggro prevented diagnosis of multi-zone marker behavior | Quest/cap gated, temporary, removable, no cap or completion grant |
| `qm18` marker recovery | Pinned marker failed after exact live interaction attempts | Restores only coal fragment 1 beside exact marker; cannot finish quest |

## Scope and public-server boundary

These decisions apply only to the isolated local private-server lab. The bridge
must never be pointed at retail FFXI, and this policy is not a claim that private
server/client use is authorized by Square Enix. A future shared server would
need a different threat model, claim ownership, player-consent rules, abuse
controls, rate limits, and removal or redesign of GM-backed conveniences.

Do not publish credentials, bridge tokens, client binaries, DAT files, server
backups containing accounts, or copyrighted assets. Public deployment remains a
separate legal, security, and product decision.
