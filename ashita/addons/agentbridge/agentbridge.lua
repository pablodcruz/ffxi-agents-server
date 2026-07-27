--[[
AgentBridge exposes a narrow, localhost-only JSON-lines interface for an AI
agent operating on a private LandSandBoat server.

It intentionally does not support GM commands, chat, arbitrary console
commands, scripts, packet injection, or remote network binding.
--]]

addon.name = 'agentbridge';
addon.author = 'FFXI Agent Lab';
addon.version = '0.10.0';
addon.desc = 'Local observation and allowlisted gameplay bridge for private-server agents.';

require 'common';

local ffi = require 'ffi';
local json = require 'json';
local socket = require 'socket';

local bridge =
{
    listener = nil,
    client = nil,
    client_buffer = '',
    config = nil,
    events = T{},
    next_event_id = 1,
    control_enabled = false,
    control_changed_at = 0,
    control_reason = 'addon_load',
    movement = nil,
    next_movement_check = 0,
    input_pulse = nil,
    heading_hold = nil,
    activity_feed_enabled = false,
};

local allowed_commands =
{
    ['/attack'] = true,
    ['/attackoff'] = true,
    ['/check'] = true,
    ['/follow'] = true,
    ['/heal'] = true,
    ['/item'] = true,
    ['/ja'] = true,
    ['/jobability'] = true,
    ['/lockon'] = true,
    ['/ma'] = true,
    ['/magic'] = true,
    ['/pet'] = true,
    ['/ra'] = true,
    ['/range'] = true,
    ['/ta'] = true,
    ['/target'] = true,
    ['/trade'] = true,
    ['/weaponskill'] = true,
    ['/ws'] = true,
};

local allowed_input_actions =
{
    forward = 0x48,
    backward = 0x50,
    turn_left = 0x4B,
    turn_right = 0x4D,
    camera_left = 0xCB,
    camera_right = 0xCD,
};

local function close_client()
    if (bridge.client ~= nil) then
        bridge.client:close();
    end
    bridge.client = nil;
    bridge.client_buffer = '';
end

local function stop_listener()
    close_client();
    if (bridge.listener ~= nil) then
        bridge.listener:close();
    end
    bridge.listener = nil;
end

local function read_config()
    local path = addon.path .. '/config.json';
    local file = io.open(path, 'rb');
    if (file == nil) then
        print('[AgentBridge] Missing config.json. Copy config.example.json and set a strong token.');
        return nil;
    end

    local content = file:read('*a');
    file:close();

    local ok, config = pcall(json.decode, content);
    if (not ok or type(config) ~= 'table') then
        print('[AgentBridge] config.json is not valid JSON.');
        return nil;
    end

    if (config.bind_host ~= '127.0.0.1') then
        print('[AgentBridge] Refusing to bind outside 127.0.0.1.');
        return nil;
    end
    if (type(config.bind_port) ~= 'number' or config.bind_port < 1024 or config.bind_port > 65535) then
        print('[AgentBridge] bind_port must be between 1024 and 65535.');
        return nil;
    end
    if (type(config.token) ~= 'string' or #config.token < 24 or config.token:find('replace%-with') == 1) then
        print('[AgentBridge] token must be replaced with at least 24 characters.');
        return nil;
    end
    if (config.activity_feed_enabled ~= nil and type(config.activity_feed_enabled) ~= 'boolean') then
        print('[AgentBridge] activity_feed_enabled must be true or false.');
        return nil;
    end
    return config;
end

local function display_activity_event(message)
    if (not bridge.activity_feed_enabled) then
        return;
    end

    local display = message
        :gsub('%c', ' ')
        :gsub('%s+', ' ')
        :match('^%s*(.-)%s*$')
        :sub(1, 180);
    local visible =
        display:find('^Agent movement ') ~= nil or
        display:find('^Agent target ') ~= nil or
        display:find('^Agent gameplay command ') ~= nil or
        display:find('^Agent heading ') ~= nil or
        display:find('^Agent .- pulse ') ~= nil or
        display:find('^Agent activity feed ') ~= nil;
    if (visible) then
        print(('[Agent Activity] %s'):fmt(display:gsub('^Agent ', '')));
    end
end

local function add_event(mode, message)
    if (type(message) ~= 'string' or #message == 0) then
        return;
    end

    message = message:gsub('[\r\n]', ' '):sub(1, 512);
    bridge.events:append(
    {
        id = bridge.next_event_id,
        timestamp = os.time(),
        mode = mode,
        message = message,
    });
    bridge.next_event_id = bridge.next_event_id + 1;

    while (#bridge.events > 100) do
        table.remove(bridge.events, 1);
    end
    if (mode == -1) then
        display_activity_event(message);
    end
end

local function stop_movement(reason)
    pcall(function ()
        local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
        auto_follow:SetIsAutoRunning(0);
        auto_follow:SetTargetIndex(0);
        auto_follow:SetTargetServerId(0);
        auto_follow:SetFollowTargetIndex(0);
        auto_follow:SetFollowTargetServerId(0);
        auto_follow:SetFollowDeltaX(0);
        auto_follow:SetFollowDeltaZ(0);
        auto_follow:SetFollowDeltaY(0);
        auto_follow:SetFollowDeltaW(1);
    end);

    local was_active = bridge.movement ~= nil;
    bridge.movement = nil;
    bridge.next_movement_check = 0;
    if (was_active) then
        add_event(-1, ('Agent movement stopped: %s'):fmt(reason or 'requested'));
    end
    return was_active;
end

local function stop_input_pulse(reason)
    local was_active = bridge.input_pulse ~= nil;
    local action = was_active and bridge.input_pulse.action or 'input';
    bridge.input_pulse = nil;
    if (was_active) then
        add_event(-1, ('Agent %s pulse stopped: %s'):fmt(action, reason or 'requested'));
    end
    return was_active;
end

local function stop_heading_hold(reason)
    local was_active = bridge.heading_hold ~= nil;
    bridge.heading_hold = nil;
    if (was_active) then
        add_event(-1, ('Agent heading hold stopped: %s'):fmt(reason or 'requested'));
    end
    return was_active;
end

local function emergency_stop(reason)
    bridge.control_enabled = false;
    bridge.control_changed_at = os.time();
    bridge.control_reason = reason or 'emergency_stop';
    stop_movement(bridge.control_reason);
    stop_input_pulse(bridge.control_reason);
    stop_heading_hold(bridge.control_reason);
    AshitaCore:GetChatManager():QueueCommand(1, '/attackoff');
    add_event(-1, ('Agent control disabled: %s'):fmt(bridge.control_reason));
end

local function require_control_enabled()
    if (not bridge.control_enabled) then
        error('Agent writes are disabled. Explicitly enable control before targeting, moving, or acting.');
    end
end

local function control_snapshot()
    local auto_running = false;
    pcall(function ()
        auto_running = AshitaCore:GetMemoryManager():GetAutoFollow():GetIsAutoRunning() > 0;
    end);
    local movement = nil;
    if (bridge.movement ~= nil) then
        movement =
        {
            kind = bridge.movement.kind,
            server_id = bridge.movement.server_id,
            name = bridge.movement.name,
            target_x = bridge.movement.target_x,
            target_y = bridge.movement.target_y,
            started_at = bridge.movement.started_at,
            deadline = bridge.movement.deadline,
            stop_distance = bridge.movement.stop_distance,
            best_distance = bridge.movement.best_distance,
            last_progress_at = bridge.movement.last_progress_at,
        };
    end
    return
    {
        enabled = bridge.control_enabled,
        changed_at = bridge.control_changed_at,
        reason = bridge.control_reason,
        auto_running = auto_running,
        movement = movement,
        input_active = bridge.input_pulse ~= nil,
        heading_active = bridge.heading_hold ~= nil,
        activity_feed_enabled = bridge.activity_feed_enabled,
    };
end

local function recent_events(limit)
    limit = math.floor(tonumber(limit) or 20);
    limit = math.clamp(limit, 0, 100);

    local result = T{};
    local first = math.max(1, #bridge.events - limit + 1);
    for index = first, #bridge.events do
        result:append(bridge.events[index]);
    end
    return result;
end

local function entity_snapshot(index, entity_manager)
    if (index == nil or index <= 0) then
        return nil;
    end

    local server_id = entity_manager:GetServerId(index);
    if (server_id == 0) then
        return nil;
    end

    local distance_squared = math.max(0, entity_manager:GetDistance(index));
    return
    {
        index = index,
        server_id = server_id,
        name = entity_manager:GetName(index) or '',
        distance = math.sqrt(distance_squared),
        hp_percent = entity_manager:GetHPPercent(index),
        status = entity_manager:GetStatus(index),
        entity_type = entity_manager:GetType(index),
        heading = entity_manager:GetHeading(index),
        position =
        {
            x = entity_manager:GetLocalPositionX(index),
            y = entity_manager:GetLocalPositionY(index),
            z = entity_manager:GetLocalPositionZ(index),
        },
    };
end

local function party_snapshot(party)
    local result = T{};
    for index = 0, 17 do
        if (party:GetMemberIsActive(index) > 0 and party:GetMemberServerId(index) > 0) then
            result:append(
            {
                slot = index,
                name = party:GetMemberName(index) or '',
                server_id = party:GetMemberServerId(index),
                target_index = party:GetMemberTargetIndex(index),
                hp = party:GetMemberHP(index),
                hp_percent = party:GetMemberHPPercent(index),
                mp = party:GetMemberMP(index),
                mp_percent = party:GetMemberMPPercent(index),
                tp = party:GetMemberTP(index),
                zone_id = party:GetMemberZone(index),
                main_job = party:GetMemberMainJob(index),
                main_job_level = party:GetMemberMainJobLevel(index),
                sub_job = party:GetMemberSubJob(index),
                sub_job_level = party:GetMemberSubJobLevel(index),
            });
        end
    end
    return result;
end

local function observe(params)
    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local party = memory:GetParty();
    local target = memory:GetTarget();
    local entities = memory:GetEntity();

    local radius = math.clamp(tonumber(params.radius) or 20, 1, 50);
    local max_entities = math.floor(math.clamp(tonumber(params.max_entities) or 32, 1, 64));
    local event_limit = math.floor(math.clamp(tonumber(params.event_limit) or 10, 0, 50));
    local player_index = party:GetMemberTargetIndex(0);
    local target_index = target:GetTargetIndex(0);
    local nearby = T{};
    local entity_map_size = entities:GetEntityMapSize();

    for index = 0, entity_map_size - 1 do
        if (index ~= player_index and entities:GetServerId(index) > 0) then
            local distance_squared = math.max(0, entities:GetDistance(index));
            if (distance_squared <= radius * radius) then
                local snapshot = entity_snapshot(index, entities);
                if (snapshot ~= nil and snapshot.name ~= '') then
                    nearby:append(snapshot);
                end
            end
        end
    end

    table.sort(nearby, function (left, right)
        return left.distance < right.distance;
    end);
    while (#nearby > max_entities) do
        table.remove(nearby);
    end

    return
    {
        observed_at = os.time(),
        login_status = player:GetLoginStatus(),
        player = entity_snapshot(player_index, entities),
        target = entity_snapshot(target_index, entities),
        party = party_snapshot(party),
        nearby_entities = nearby,
        recent_events = recent_events(event_limit),
        control = control_snapshot(),
    };
end

local function resource_entry_name(entry, fallback)
    if (entry == nil) then
        return fallback;
    end

    local ok, name = pcall(function ()
        return entry.Name[1];
    end);
    if (not ok or type(name) ~= 'string' or #name == 0) then
        return fallback;
    end
    return name:sub(1, 128);
end

local function buff_name(resource_manager, id)
    local ok, name = pcall(function ()
        return resource_manager:GetString('buffs.names', id);
    end);
    if (not ok or type(name) ~= 'string' or #name == 0) then
        return ('Unknown status %d'):fmt(id);
    end
    return name:sub(1, 128);
end

local function character_state(params)
    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local login_status = tonumber(player:GetLoginStatus()) or 0;
    if (login_status ~= 2) then
        error('Character state is unavailable until a character is logged in.');
    end

    local resources = AshitaCore:GetResourceManager();
    local target = memory:GetTarget();
    local result =
    {
        observed_at = os.time(),
        login_status = login_status,
        player =
        {
            hp_max = tonumber(player:GetHPMax()),
            mp_max = tonumber(player:GetMPMax()),
            main_job_id = tonumber(player:GetMainJob()),
            main_job_level = tonumber(player:GetMainJobLevel()),
            sub_job_id = tonumber(player:GetSubJob()),
            sub_job_level = tonumber(player:GetSubJobLevel()),
            exp_current = tonumber(player:GetExpCurrent()),
            exp_needed = tonumber(player:GetExpNeeded()),
            attack = tonumber(player:GetAttack()),
            defense = tonumber(player:GetDefense()),
            title_id = tonumber(player:GetTitle()),
            rank = tonumber(player:GetRank()),
            rank_points = tonumber(player:GetRankPoints()),
            nation_id = tonumber(player:GetNation()),
            zoning = player:GetIsZoning() ~= 0,
        },
        menu_open = target:GetIsMenuOpen() ~= 0,
        statuses = T{},
    };

    -- Buff ids are the current effects. Status-icon ids and timers are the
    -- client timer-display slots. The SDK does not document the status timer
    -- unit, so it is deliberately returned as an unconverted raw value.
    local buffs = player:GetBuffs();
    local status_icons = player:GetStatusIcons();
    local status_timers = player:GetStatusTimers();
    for index = 0, 31 do
        local buff_id = tonumber(buffs[index]) or -1;
        local status_icon_id = tonumber(status_icons[index]) or -1;
        if (buff_id > 0 or status_icon_id > 0) then
            local name_id = buff_id > 0 and buff_id or status_icon_id;
            result.statuses:append(
            {
                slot = index,
                buff_id = buff_id,
                status_icon_id = status_icon_id,
                name = buff_name(resources, name_id),
                timer_raw = tonumber(status_timers[index]) or 0,
            });
        end
    end

    if (params.include_recasts ~= false) then
        local max_recasts = math.floor(math.clamp(tonumber(params.max_recasts) or 32, 1, 64));
        local recast = memory:GetRecast();
        result.recasts = T{};

        for index = 0, 31 do
            if (#result.recasts >= max_recasts) then
                break;
            end
            local timer = tonumber(recast:GetAbilityTimer(index)) or 0;
            local timer_id = tonumber(recast:GetAbilityTimerId(index)) or 0;
            if (timer > 0 and (timer_id ~= 0 or index == 0)) then
                local fallback = index == 0 and 'Job one-hour ability' or ('Unknown ability %d'):fmt(timer_id);
                local ok, ability = pcall(function ()
                    return resources:GetAbilityByTimerId(timer_id);
                end);
                result.recasts:append(
                {
                    kind = 'ability',
                    slot = index,
                    timer_id = timer_id,
                    name = resource_entry_name(ok and ability or nil, fallback),
                    timer_ticks = timer,
                    seconds = timer / 60,
                });
            end
        end

        for spell_id = 0, 1024 do
            if (#result.recasts >= max_recasts) then
                break;
            end
            local timer = tonumber(recast:GetSpellTimer(spell_id)) or 0;
            if (timer > 0) then
                local ok, spell = pcall(function ()
                    return resources:GetSpellById(spell_id);
                end);
                result.recasts:append(
                {
                    kind = 'spell',
                    spell_id = spell_id,
                    name = resource_entry_name(ok and spell or nil, ('Unknown spell %d'):fmt(spell_id)),
                    timer_ticks = timer,
                    seconds = timer / 60,
                });
            end
        end
    end

    if (params.inventory_container ~= nil) then
        local container = math.floor(tonumber(params.inventory_container) or -1);
        if (container < 0 or container > 16) then
            error('inventory_container must be between 0 and 16.');
        end

        local max_items = math.floor(math.clamp(tonumber(params.max_items) or 40, 1, 80));
        local inventory = memory:GetInventory();
        local container_max = tonumber(inventory:GetContainerCountMax(container)) or 0;
        local snapshot =
        {
            container_id = container,
            count = tonumber(inventory:GetContainerCount(container)) or 0,
            capacity = container_max,
            items = T{},
            truncated = false,
        };

        for slot = 0, math.min(container_max, 80) do
            local item = inventory:GetContainerItem(container, slot);
            if (item ~= nil and tonumber(item.Id) ~= nil and tonumber(item.Id) > 0) then
                if (#snapshot.items >= max_items) then
                    snapshot.truncated = true;
                    break;
                end
                local item_id = tonumber(item.Id);
                local ok, resource_item = pcall(function ()
                    return resources:GetItemById(item_id);
                end);
                snapshot.items:append(
                {
                    slot = slot,
                    item_id = item_id,
                    name = resource_entry_name(ok and resource_item or nil, ('Unknown item %d'):fmt(item_id)),
                    count = tonumber(item.Count) or 0,
                    flags = tonumber(item.Flags) or 0,
                });
            end
        end
        result.inventory = snapshot;
    end

    return result;
end

local function find_target(params)
    local memory = AshitaCore:GetMemoryManager();
    local entities = memory:GetEntity();
    local target = memory:GetTarget();
    local entity_map_size = entities:GetEntityMapSize();
    local requested_id = tonumber(params.server_id);
    local requested_name = type(params.name) == 'string' and params.name:lower() or nil;
    local max_distance = math.clamp(tonumber(params.max_distance) or 30, 1, 50);

    for index = 0, entity_map_size - 1 do
        local server_id = entities:GetServerId(index);
        if (server_id > 0 and entities:GetDistance(index) <= max_distance * max_distance) then
            local name = entities:GetName(index) or '';
            local matches = false;
            if (requested_id ~= nil) then
                -- An explicit server ID must disambiguate duplicate entity names.
                matches = server_id == requested_id;
            elseif (requested_name ~= nil) then
                matches = name:lower() == requested_name;
            end
            if (matches) then
                target:SetTarget(index, true);
                local snapshot = entity_snapshot(index, entities);
                add_event(-1, ('Agent target selected: %s (%u).'):fmt(
                    snapshot.name,
                    snapshot.server_id
                ));
                return snapshot;
            end
        end
    end

    error('No matching entity was found within the requested distance.');
end

local function clear_target()
    require_control_enabled();
    stop_movement('target_clear');
    local target = AshitaCore:GetMemoryManager():GetTarget();
    target:SetTarget(0, true);
    add_event(-1, 'Agent target lock cleared.');
    return
    {
        cleared = target:GetTargetIndex(0) == 0,
        target_index = tonumber(target:GetTargetIndex(0)),
        control = control_snapshot(),
    };
end

local function set_heading(params)
    require_control_enabled();
    stop_movement('heading_change');

    local heading = tonumber(params.heading);
    if (heading == nil or heading ~= heading or heading < -math.pi or heading > math.pi) then
        error('heading must be a finite number from -pi through pi.');
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot set heading until a character is logged in.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Cannot set heading while an in-game menu or dialogue is open.');
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        error('Could not resolve the local player entity.');
    end

    target:SetTarget(0, true);
    bridge.heading_hold = { heading = heading };
    entities:SetLocalPositionYaw(player_index, heading);
    entities:SetHeading(player_index, heading);
    add_event(-1, ('Agent heading set to %.4f radians.'):fmt(heading));
    return
    {
        heading = entities:GetHeading(player_index),
        local_position_yaw = entities:GetLocalPositionYaw(player_index),
        requested_heading = heading,
        player = entity_snapshot(player_index, entities),
        control = control_snapshot(),
    };
end

local function apply_heading_hold()
    local hold = bridge.heading_hold;
    if (hold == nil) then
        return;
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (not bridge.control_enabled or player:GetLoginStatus() ~= 2) then
        stop_heading_hold('control_disabled_or_logged_out');
        return;
    end
    if (target:GetIsMenuOpen() ~= 0) then
        stop_heading_hold('menu_open');
        return;
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        stop_heading_hold('player_unavailable');
        return;
    end

    entities:SetLocalPositionYaw(player_index, hold.heading);
    entities:SetHeading(player_index, hold.heading);
end

local function start_confirm_pulse(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot inject confirm input until a character is logged in.');
    end
    if (bridge.input_pulse ~= nil) then
        error('A confirm input pulse is already active.');
    end

    local mode = type(params.mode) == 'string' and params.mode:lower() or 'target';
    local entity = nil;
    if (mode == 'target') then
        params.max_distance = math.clamp(tonumber(params.max_distance) or 6, 1, 6);
        entity = find_target(params);
        if (entity.entity_type ~= 1 and entity.entity_type ~= 2 and entity.entity_type ~= 3) then
            error('The requested interaction target is not an NPC or world object.');
        end
    elseif (mode == 'confirm') then
        error('Confirm mode requires the host MCP input adapter.');
    else
        error('Interaction mode must be target or confirm.');
    end

    stop_movement('interaction');
    bridge.input_pulse =
    {
        key = 0x1C,
        action = 'confirm',
        mode = mode,
        down_frames = 2,
        deadline = socket.gettime() + 0.08,
        release_frames = 2,
        requested_at = socket.gettime(),
    };
    add_event(-1, ('Agent confirm pulse queued (%s).'):fmt(mode));
    return
    {
        queued = true,
        mode = mode,
        entity = entity,
        menu_open = target:GetIsMenuOpen() ~= 0,
        control = control_snapshot(),
    };
end

local function start_input_pulse(params)
    require_control_enabled();
    stop_movement('directional_input');

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot inject directional input until a character is logged in.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Cannot inject directional input while an in-game menu or dialogue is open.');
    end
    if (bridge.input_pulse ~= nil) then
        error('An input pulse is already active.');
    end

    local action = type(params.action) == 'string' and params.action:lower() or '';
    local key = allowed_input_actions[action];
    if (key == nil) then
        error('Directional input action is outside the AgentBridge allowlist.');
    end
    local duration_ms = math.floor(tonumber(params.duration_ms) or 250);
    if (duration_ms < 50 or duration_ms > 1000) then
        error('duration_ms must be between 50 and 1000.');
    end

    target:SetTarget(0, true);
    local now = socket.gettime();
    bridge.input_pulse =
    {
        key = key,
        action = action,
        down_frames = 2,
        deadline = now + (duration_ms / 1000),
        release_frames = 2,
        requested_at = now,
    };
    add_event(-1, ('Agent %s pulse queued for %u ms.'):fmt(action, duration_ms));
    return
    {
        queued = true,
        action = action,
        key = key,
        duration_ms = duration_ms,
        input_source = 'agentbridge_directinput',
        control = control_snapshot(),
    };
end

local function start_movement(params)
    require_control_enabled();

    local timeout_seconds = math.clamp(tonumber(params.timeout_seconds) or 10, 1, 20);
    local stuck_seconds = math.clamp(tonumber(params.stuck_seconds) or 3, 1, 8);
    local stop_distance = math.clamp(tonumber(params.stop_distance) or 3, 1, 10);
    local max_start_distance = math.clamp(tonumber(params.max_start_distance) or 25, 2, 40);
    if (stop_distance >= max_start_distance) then
        error('stop_distance must be smaller than max_start_distance.');
    end

    params.max_distance = max_start_distance;
    local entity = find_target(params);
    if (entity.distance <= stop_distance) then
        stop_movement('already_within_stop_distance');
        return
        {
            started = false,
            reason = 'already_within_stop_distance',
            entity = entity,
            control = control_snapshot(),
        };
    end

    stop_movement('replaced');
    local now = socket.gettime();
    local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
    auto_follow:SetTargetIndex(entity.index);
    auto_follow:SetTargetServerId(entity.server_id);
    auto_follow:SetFollowTargetIndex(entity.index);
    auto_follow:SetFollowTargetServerId(entity.server_id);
    auto_follow:SetFollowDeltaX(0);
    auto_follow:SetFollowDeltaZ(0);
    auto_follow:SetFollowDeltaY(0);
    auto_follow:SetFollowDeltaW(1);
    auto_follow:SetIsAutoRunning(1);

    bridge.movement =
    {
        kind = 'entity',
        index = entity.index,
        server_id = entity.server_id,
        name = entity.name,
        started_at = now,
        deadline = now + timeout_seconds,
        stop_distance = stop_distance,
        stuck_seconds = stuck_seconds,
        best_distance = entity.distance,
        last_progress_at = now,
    };
    bridge.next_movement_check = now + 0.1;
    add_event(-1, ('Agent movement started toward %s (%u).'):fmt(entity.name, entity.server_id));
    return
    {
        started = true,
        entity = entity,
        control = control_snapshot(),
    };
end

local function player_position()
    local memory = AshitaCore:GetMemoryManager();
    local player_index = memory:GetParty():GetMemberTargetIndex(0);
    local entities = memory:GetEntity();
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        return nil;
    end
    return
        entities:GetLocalPositionX(player_index),
        entities:GetLocalPositionY(player_index),
        entities:GetLocalPositionZ(player_index);
end

local function drive_toward_position(x, y)
    local px, py = player_position();
    if (px == nil) then
        error('Player position is unavailable.');
    end

    local dx = x - px;
    local dy = y - py;
    local distance = math.sqrt((dx * dx) + (dy * dy));
    if (distance > 0.01) then
        dx = dx / distance;
        dy = dy / distance;
    end

    local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
    auto_follow:SetTargetIndex(0);
    auto_follow:SetTargetServerId(0);
    auto_follow:SetFollowTargetIndex(0);
    auto_follow:SetFollowTargetServerId(0);
    auto_follow:SetFollowDeltaX(dx);
    auto_follow:SetFollowDeltaZ(0);
    auto_follow:SetFollowDeltaY(dy);
    auto_follow:SetFollowDeltaW(1);
    auto_follow:SetIsAutoRunning(1);
    return distance;
end

local function start_position_movement(params)
    require_control_enabled();

    local target_x = tonumber(params.x);
    local target_y = tonumber(params.y);
    if (target_x == nil or target_y == nil or target_x ~= target_x or target_y ~= target_y) then
        error('x and y must be finite world coordinates.');
    end
    if (math.abs(target_x) > 10000 or math.abs(target_y) > 10000) then
        error('x and y are outside the supported world-coordinate range.');
    end

    local timeout_seconds = math.clamp(tonumber(params.timeout_seconds) or 15, 1, 60);
    local stuck_seconds = math.clamp(tonumber(params.stuck_seconds) or 3, 1, 8);
    local stop_distance = math.clamp(tonumber(params.stop_distance) or 1, 0.5, 5);
    local max_start_distance = math.clamp(tonumber(params.max_start_distance) or 60, 2, 100);
    local px, py, pz = player_position();
    if (px == nil) then
        error('Player position is unavailable.');
    end
    local dx = target_x - px;
    local dy = target_y - py;
    local distance = math.sqrt((dx * dx) + (dy * dy));
    if (distance > max_start_distance) then
        error('Position waypoint is beyond max_start_distance.');
    end
    if (distance <= stop_distance) then
        stop_movement('already_within_stop_distance');
        return
        {
            started = false,
            reason = 'already_within_stop_distance',
            target = { x = target_x, y = target_y, z = pz },
            distance = distance,
            control = control_snapshot(),
        };
    end

    stop_movement('replaced');
    local now = socket.gettime();
    drive_toward_position(target_x, target_y);
    bridge.movement =
    {
        kind = 'position',
        target_x = target_x,
        target_y = target_y,
        started_at = now,
        deadline = now + timeout_seconds,
        stop_distance = stop_distance,
        stuck_seconds = stuck_seconds,
        best_distance = distance,
        last_progress_at = now,
    };
    bridge.next_movement_check = now + 0.1;
    add_event(-1, ('Agent movement started toward waypoint (%.2f, %.2f).'):fmt(target_x, target_y));
    return
    {
        started = true,
        target = { x = target_x, y = target_y, z = pz },
        distance = distance,
        control = control_snapshot(),
    };
end

local function monitor_movement()
    if (bridge.movement == nil) then
        return;
    end

    local now = socket.gettime();
    if (now < bridge.next_movement_check) then
        return;
    end
    bridge.next_movement_check = now + 0.1;

    local memory = AshitaCore:GetMemoryManager();
    if (memory:GetPlayer():GetLoginStatus() ~= 2) then
        stop_movement('not_logged_in');
        return;
    end

    local movement = bridge.movement;
    local distance;
    if (movement.kind == 'position') then
        local px, py = player_position();
        if (px == nil) then
            stop_movement('player_position_unavailable');
            return;
        end
        local dx = movement.target_x - px;
        local dy = movement.target_y - py;
        distance = math.sqrt((dx * dx) + (dy * dy));
    else
        local entities = memory:GetEntity();
        if (entities:GetServerId(movement.index) ~= movement.server_id) then
            stop_movement('target_lost');
            return;
        end
        distance = math.sqrt(math.max(0, entities:GetDistance(movement.index)));
    end
    if (distance <= movement.stop_distance) then
        stop_movement('arrived');
        return;
    end
    if (now >= movement.deadline) then
        stop_movement('timeout');
        return;
    end

    if (distance <= movement.best_distance - 0.5) then
        movement.best_distance = distance;
        movement.last_progress_at = now;
    elseif (now - movement.last_progress_at >= movement.stuck_seconds) then
        stop_movement('no_progress');
        return;
    end

    if (movement.kind == 'position') then
        drive_toward_position(movement.target_x, movement.target_y);
    end
    if (memory:GetAutoFollow():GetIsAutoRunning() == 0) then
        stop_movement('client_stopped');
    end
end

local function validate_command(command)
    if (type(command) ~= 'string') then
        error('Command must be a string.');
    end

    command = command:match('^%s*(.-)%s*$');
    if (#command == 0 or #command > 200) then
        error('Command must contain between 1 and 200 characters.');
    end
    if (command:find('[\r\n;|]') ~= nil or command:sub(1, 1) == '!') then
        error('Command chaining, control characters, and GM commands are blocked.');
    end

    local verb = command:match('^(%S+)');
    if (verb == nil or allowed_commands[verb:lower()] ~= true) then
        error('Command is outside the AgentBridge gameplay allowlist.');
    end
    return command;
end

local function dispatch(request)
    if (type(request) ~= 'table') then
        error('Request must be a JSON object.');
    end
    if (request.token ~= bridge.config.token) then
        error('Authentication failed.');
    end

    local params = type(request.params) == 'table' and request.params or {};
    if (request.operation == 'control_status') then
        return control_snapshot();
    elseif (request.operation == 'enable_control') then
        if (params.confirmation ~= 'ENABLE PRIVATE SERVER CONTROL') then
            error('Enabling control requires the exact confirmation phrase.');
        end
        if (AshitaCore:GetMemoryManager():GetPlayer():GetLoginStatus() ~= 2) then
            error('Cannot enable agent writes until a character is logged in.');
        end
        bridge.control_enabled = true;
        bridge.control_changed_at = os.time();
        bridge.control_reason = 'explicit_enable';
        add_event(-1, 'Agent control explicitly enabled.');
        return control_snapshot();
    elseif (request.operation == 'emergency_stop') then
        emergency_stop('emergency_stop');
        return control_snapshot();
    elseif (request.operation == 'set_activity_feed') then
        require_control_enabled();
        if (type(params.enabled) ~= 'boolean') then
            error('Activity feed enabled must be true or false.');
        end
        bridge.activity_feed_enabled = params.enabled;
        local state = params.enabled and 'enabled' or 'disabled';
        if (params.enabled) then
            add_event(-1, ('Agent activity feed %s.'):fmt(state));
        else
            print('[Agent Activity] feed disabled.');
            add_event(-1, ('Agent activity feed %s.'):fmt(state));
        end
        return
        {
            enabled = bridge.activity_feed_enabled,
            local_chat_only = true,
            control = control_snapshot(),
        };
    elseif (request.operation == 'stop_movement') then
        stop_movement('requested');
        return control_snapshot();
    elseif (request.operation == 'observe') then
        return observe(params);
    elseif (request.operation == 'character_state') then
        return character_state(params);
    elseif (request.operation == 'recent_events') then
        return recent_events(params.limit);
    elseif (request.operation == 'target_entity') then
        require_control_enabled();
        return find_target(params);
    elseif (request.operation == 'clear_target') then
        return clear_target();
    elseif (request.operation == 'set_heading') then
        return set_heading(params);
    elseif (request.operation == 'interact') then
        return start_confirm_pulse(params);
    elseif (request.operation == 'input_action') then
        return start_input_pulse(params);
    elseif (request.operation == 'move_to_entity') then
        return start_movement(params);
    elseif (request.operation == 'move_to_position') then
        return start_position_movement(params);
    elseif (request.operation == 'gameplay_command') then
        require_control_enabled();
        local command = validate_command(params.command);
        AshitaCore:GetChatManager():QueueCommand(1, command);
        local verb = command:match('^(%S+)') or 'gameplay command';
        add_event(-1, ('Agent gameplay command queued: %s.'):fmt(verb:lower()));
        return
        {
            queued = true,
            command = command,
        };
    end

    error('Unknown operation.');
end

local function respond(request)
    local response =
    {
        id = type(request) == 'table' and request.id or nil,
        ok = false,
    };

    local ok, value = pcall(dispatch, request);
    if (ok) then
        response.ok = true;
        response.result = value;
    else
        response.error = tostring(value);
    end

    bridge.client:settimeout(0.1);
    bridge.client:send(json.encode(response) .. '\n');
    close_client();
end

local function process_client()
    if (bridge.client == nil) then
        local client = bridge.listener:accept();
        if (client ~= nil) then
            bridge.client = client;
            bridge.client:settimeout(0);
            bridge.client_buffer = '';
        end
        return;
    end

    local chunk, receive_error, partial = bridge.client:receive(4096);
    local received = chunk or partial;
    if (received ~= nil and #received > 0) then
        bridge.client_buffer = bridge.client_buffer .. received;
    end

    if (#bridge.client_buffer > 16384) then
        close_client();
        return;
    end

    local newline = bridge.client_buffer:find('\n', 1, true);
    if (newline ~= nil) then
        local line = bridge.client_buffer:sub(1, newline - 1);
        local ok, request = pcall(json.decode, line);
        if (not ok) then
            request = {};
        end
        respond(request);
        return;
    end

    if (receive_error == 'closed') then
        close_client();
    end
end

ashita.events.register('load', 'load_cb', function ()
    bridge.config = read_config();
    if (bridge.config == nil) then
        return;
    end

    bridge.control_enabled = false;
    bridge.control_changed_at = os.time();
    bridge.control_reason = 'addon_load';
    bridge.activity_feed_enabled = bridge.config.activity_feed_enabled == true;

    local listener, listen_error = socket.bind(bridge.config.bind_host, bridge.config.bind_port);
    if (listener == nil) then
        print(('[AgentBridge] Failed to listen: %s'):fmt(tostring(listen_error)));
        return;
    end

    bridge.listener = listener;
    bridge.listener:settimeout(0);
    print(('[AgentBridge] Listening on %s:%u with writes disabled.'):fmt(bridge.config.bind_host, bridge.config.bind_port));
    if (bridge.activity_feed_enabled) then
        print('[Agent Activity] feed enabled from config.');
    end
end);

ashita.events.register('unload', 'unload_cb', function ()
    emergency_stop('addon_unload');
    stop_listener();
end);

ashita.events.register('text_in', 'text_in_cb', function (event)
    add_event(event.mode, event.message_modified);
end);

ashita.events.register('key_state', 'key_state_cb', function (event)
    local pulse = bridge.input_pulse;
    if (pulse == nil) then
        return;
    end

    local memory = AshitaCore:GetMemoryManager();
    if (not bridge.control_enabled or memory:GetPlayer():GetLoginStatus() ~= 2) then
        stop_input_pulse('control_disabled_or_logged_out');
        return;
    end
    if (event.data_raw == nil or event.size <= pulse.key) then
        stop_input_pulse('keyboard_state_unavailable');
        return;
    end

    local keys = ffi.cast('uint8_t*', event.data_raw);
    if (pulse.down_frames > 0 or socket.gettime() < pulse.deadline) then
        keys[pulse.key] = 0x80;
        pulse.down_frames = math.max(0, pulse.down_frames - 1);
        return;
    end

    keys[pulse.key] = 0;
    pulse.release_frames = pulse.release_frames - 1;
    if (pulse.release_frames <= 0) then
        add_event(-1, ('Agent %s pulse completed.'):fmt(pulse.action));
        bridge.input_pulse = nil;
    end
end);

ashita.events.register('d3d_present', 'present_cb', function ()
    apply_heading_hold();
    monitor_movement();
    if (bridge.listener ~= nil) then
        process_client();
    end
end);
