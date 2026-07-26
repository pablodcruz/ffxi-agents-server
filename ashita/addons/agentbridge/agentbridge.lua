--[[
AgentBridge exposes a narrow, localhost-only JSON-lines interface for an AI
agent operating on a private LandSandBoat server.

It intentionally does not support GM commands, chat, arbitrary console
commands, scripts, packet injection, or remote network binding.
--]]

addon.name = 'agentbridge';
addon.author = 'FFXI Agent Lab';
addon.version = '0.3.0';
addon.desc = 'Local observation and allowlisted gameplay bridge for private-server agents.';

require 'common';

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
    ['/weaponskill'] = true,
    ['/ws'] = true,
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
    return config;
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

local function emergency_stop(reason)
    bridge.control_enabled = false;
    bridge.control_changed_at = os.time();
    bridge.control_reason = reason or 'emergency_stop';
    stop_movement(bridge.control_reason);
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
            server_id = bridge.movement.server_id,
            name = bridge.movement.name,
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
            local id_matches = requested_id ~= nil and server_id == requested_id;
            local name_matches = requested_name ~= nil and name:lower() == requested_name;
            if (id_matches or name_matches) then
                target:SetTarget(index, true);
                return entity_snapshot(index, entities);
            end
        end
    end

    error('No matching entity was found within the requested distance.');
end

local function start_movement(params)
    require_control_enabled();

    local timeout_seconds = math.clamp(tonumber(params.timeout_seconds) or 10, 1, 20);
    local stuck_seconds = math.clamp(tonumber(params.stuck_seconds) or 3, 1, 8);
    local stop_distance = math.clamp(tonumber(params.stop_distance) or 3, 1, 10);
    local max_start_distance = math.clamp(tonumber(params.max_start_distance) or 25, 2, 30);
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
    local entities = memory:GetEntity();
    if (entities:GetServerId(movement.index) ~= movement.server_id) then
        stop_movement('target_lost');
        return;
    end

    local distance = math.sqrt(math.max(0, entities:GetDistance(movement.index)));
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
    elseif (request.operation == 'move_to_entity') then
        return start_movement(params);
    elseif (request.operation == 'gameplay_command') then
        require_control_enabled();
        local command = validate_command(params.command);
        AshitaCore:GetChatManager():QueueCommand(1, command);
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

    local listener, listen_error = socket.bind(bridge.config.bind_host, bridge.config.bind_port);
    if (listener == nil) then
        print(('[AgentBridge] Failed to listen: %s'):fmt(tostring(listen_error)));
        return;
    end

    bridge.listener = listener;
    bridge.listener:settimeout(0);
    print(('[AgentBridge] Listening on %s:%u with writes disabled.'):fmt(bridge.config.bind_host, bridge.config.bind_port));
end);

ashita.events.register('unload', 'unload_cb', function ()
    emergency_stop('addon_unload');
    stop_listener();
end);

ashita.events.register('text_in', 'text_in_cb', function (event)
    add_event(event.mode, event.message_modified);
end);

ashita.events.register('d3d_present', 'present_cb', function ()
    monitor_movement();
    if (bridge.listener ~= nil) then
        process_client();
    end
end);
