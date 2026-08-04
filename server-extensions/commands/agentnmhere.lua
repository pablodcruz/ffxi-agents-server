-----------------------------------
-- Collision-recovery helper for the FFXI Agent Lab's Argus camp.
--
-- This command cannot spawn or defeat anything. It only moves an already
-- spawned Argus or Leech King a few yalms to the invoking player after the
-- client has reached the live NM but broken zone collision prevents combat.
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = 'i',
}

local mazeOfShakhrami = 198
local maximumDistance = 10
local allowedMobs =
{
    [17588674] = 'Argus',
    [17588685] = 'Leech King',
}

local function report(player, message)
    player:printToPlayer(string.format('[AgentNMHere] %s', message))
end

commandObj.onTrigger = function(player, mobId)
    local expectedName = allowedMobs[mobId]
    if expectedName == nil then
        report(player, 'rejected: mob ID is outside the exact allowlist')
        return
    end

    if player:getZoneID() ~= mazeOfShakhrami then
        report(player, string.format('rejected: requires zone=%u', mazeOfShakhrami))
        return
    end

    local mob = GetMobByID(mobId)
    if mob == nil or mob:getZoneID() ~= mazeOfShakhrami then
        report(player, 'rejected: allowlisted NM is unavailable')
        return
    end

    if not mob:isSpawned() then
        report(player, 'rejected: NM is not naturally spawned')
        return
    end

    local distance = player:checkDistance(mob)
    if distance > maximumDistance then
        report(player, string.format(
            'rejected: %s distance=%.2f exceeds %u',
            expectedName,
            distance,
            maximumDistance
        ))
        return
    end

    mob:setPos(
        player:getXPos(),
        player:getYPos(),
        player:getZPos(),
        player:getRotPos(),
        mazeOfShakhrami
    )
    report(player, string.format('repositioned %s id=%u distance=%.2f', expectedName, mobId, distance))
end

return commandObj
