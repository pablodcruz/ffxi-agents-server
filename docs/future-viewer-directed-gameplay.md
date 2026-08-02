# Future goal — viewer-directed gameplay

Status: research complete; implementation deferred
Last reviewed: 2026-08-02

## Goal

Allow Twitch and YouTube viewers to propose a small set of predetermined,
bounded gameplay goals through live-chat commands. Accepted commands should
enter a guarded queue and may update Pablo's next in-game objective without
giving viewers direct access to prompts, MCP tools, movement, credentials, or
the game client.

The initial interaction should be goal-oriented rather than frame-by-frame
crowd control. Example commands:

```text
!pablo status
!pablo hunt lizzy
!pablo hunt sophie
!pablo hunt jack
!pablo hunt spipi
!pablo hunt emperor
!pablo vote emperor
!pablo route nms
```

## Proposed architecture

Create a separate `ffxi-chat-director` repository with independently
replaceable components:

1. A Restream Chat WebSocket collector for the connected Twitch and YouTube
   destinations.
2. A normalizer that converts platform events into one internal message
   envelope and deduplicates platform message IDs and relayed bot messages.
3. A strict parser that accepts only an explicit command prefix, verb, and
   allowlisted arguments. Raw chat text must never become an AI prompt, shell
   command, MCP argument, or game command.
4. A voting, cooldown, expiration, and single-goal queue policy.
5. A loopback-only goal gateway owned by this repository. The gateway must
   validate a versioned typed request against live character and supervisor
   state before invoking the existing guarded execution layer.
6. Chat acknowledgements and telemetry for accepted, rejected, queued,
   started, completed, expired, and safety-aborted requests.

Restream is the preferred first ingestion layer because its official Chat API
aggregates Twitch and YouTube events into one authenticated real-time feed:

- <https://developers.restream.io/chat>
- <https://developers.restream.io/chat/getting-started>
- <https://developers.restream.io/chat/events>
- <https://developers.restream.io/events/event-chat-history>

Direct Twitch EventSub and YouTube `liveChatMessages.streamList` integrations
remain fallbacks if Restream omits data needed by a later feature:

- <https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/>
- <https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList>

## Typed request boundary

An accepted command should produce a bounded request similar to:

```json
{
  "schema": "viewer-goal-request/v1",
  "type": "hunt_nm",
  "profile_id": "valkurm_emperor",
  "maximum_rounds": 1,
  "maximum_seconds": 600,
  "source": "youtube",
  "message_id": "platform-message-id",
  "requester_id": "privacy-preserving-viewer-id",
  "expires_at": "2026-08-02T18:00:00Z"
}
```

The FFXI project remains the final policy authority. The chat service must not
edit `goal.md`, mutate a Codex thread goal, call unrestricted gameplay tools,
or possess a reusable bridge credential. A minimal loopback or Unix-socket
adapter should accept only the versioned request schema and map it onto
existing guarded supervisors.

The current NM supervisor will likely need one new narrow input such as
`nm_profile_id` or `route_profile_ids`, validated exclusively against
`NM_ROUTE_PROFILES`. The existing `nm_route` option is designed primarily for
the established multi-camp route and should not accept viewer-provided names.

## Safety policy

- Keep one active viewer goal and at most one queued successor.
- Start with owner/moderator-only proposals, then introduce viewer voting.
- Apply per-viewer and global rate limits, command cooldowns, and short queue
  expiration.
- Recheck login, menu, combat, health, inventory capacity, active lease, and
  write-latch state immediately before dispatch.
- Preserve all existing death, disconnect, inventory, timeout, target, route,
  and emergency-stop guards.
- Never expose viewer commands for arbitrary movement, chat, teleportation,
  trading, inventory deletion, spending, GM operations, or raw target names.
- Ignore bot-authored and relayed messages to prevent cross-platform command
  loops.
- Use platform message IDs as idempotency keys. Do not rely on Restream's
  generic event identifier as a unique message identifier.
- Give the operator an immediate kill switch that stops the active lease,
  rejects queued goals, and disables further dispatch without disabling chat
  collection.

## Minimal infrastructure

Do not introduce Kafka for the first version. Run one long-lived Node service
on the Mac mini or another always-on host with:

- the Restream WebSocket collector;
- SQLite in WAL mode for commands, votes, state transitions, and idempotency;
- a loopback HTTP endpoint or Unix socket for typed goal dispatch;
- OAuth secrets stored outside the repository; and
- a read-only export into the telemetry pipeline and dashboard.

Vercel may display command and outcome data, but the persistent WebSocket
collector should not depend on a short-lived serverless request lifecycle.

## Telemetry and privacy

Record the platform, hashed viewer identity, normalized command, acceptance or
rejection reason, vote result, queue delay, goal and lease IDs, Git commit,
execution outcome, safety stops, fights, NM result, reward, and end-to-end
latency.

Do not publish viewer identities by default. Avoid retaining arbitrary raw
chat indefinitely; retain only the bounded command text or a short-lived raw
event when it is required for debugging.

## Rollout

1. **Shadow mode:** ingest, normalize, deduplicate, parse, and record commands;
   execute nothing.
2. **Owner/moderator mode:** allow trusted users to queue one bounded NM goal,
   with manual approval before dispatch.
3. **Viewer voting:** open timed votes over an explicit set of safe goals and
   queue the winner.
4. **Automatic dispatch:** start the winning goal only after all local guards
   pass; acknowledge the state transition in chat.
5. **Personality layer:** add an FFXI-themed bot voice for status and outcome
   messages without changing the control policy.

## Initial acceptance criteria

- Twitch and YouTube messages arrive through one collector with their source
  platform preserved.
- Duplicate, relayed, bot-authored, malformed, expired, and rate-limited
  commands never reach the goal gateway.
- Shadow-mode decisions are deterministic and replayable from stored command
  events.
- Only exact allowlisted NM profile IDs can be dispatched.
- A busy or unsafe character causes a visible queue, rejection, or safety-abort
  result rather than an unsafe action.
- Every accepted request can be traced from platform message ID through goal,
  lease, Git commit, and final outcome.
- Disabling the director cannot interrupt or destabilize the existing agent,
  server, OBS, Restream, or telemetry services.
