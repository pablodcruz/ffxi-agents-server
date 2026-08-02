-----------------------------------
-- Quest-gated survival protection for the FFXI Agent Lab.
--
-- This command exists only to make the modern Genkai-1 ??? route safe for a
-- local solo agent. It does not begin or complete the quest, grant key items,
-- grant inventory items, change level/EXP, or alter the level cap. All nine
-- markers and Maat's final trade still use their normal quest handlers.
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = 's',
}

local questLog = xi.questLog.JEUNO
local questId = xi.quest.id.jeuno.IN_DEFIANT_CHALLENGE
local stateVar = 'AgentQuestSafety'
local protectionPower = 2500

local function report(player, message)
    player:printToPlayer(string.format('[AgentQuestSafety] %s', message))
end

local function removeProtection(player)
    player:setGMHidden(false)
    player:setUntargetable(false)
    player:delStatusEffect(xi.effect.PERFECT_DODGE)
    player:delStatusEffect(xi.effect.INVINCIBLE)
    player:delStatusEffect(xi.effect.ELEMENTAL_SFORZO)
    player:delStatusEffect(xi.effect.REGEN)
    player:delMod(xi.mod.DEF, protectionPower)
    player:delMod(xi.mod.MDEF, protectionPower)
    player:delMod(xi.mod.MEVA, protectionPower)
    player:setCharVar(stateVar, 0)
end

local function addProtection(player)
    -- GM hidden is intentionally left off because the server treats it like
    -- invisibility and rejects ordinary NPC/??? interactions while active.
    player:setGMHidden(false)
    -- Unlike GM hidden, untargetable prevents nearby mobs from creating an
    -- auto-target race while still allowing ordinary NPC/??? interaction.
    player:setUntargetable(true)
    player:addStatusEffect(xi.effect.PERFECT_DODGE, { power = 1, origin = player })
    player:addStatusEffect(xi.effect.INVINCIBLE, { power = 1, origin = player })
    player:addStatusEffect(xi.effect.ELEMENTAL_SFORZO, { power = 1, origin = player })
    player:addStatusEffect(xi.effect.REGEN, { power = 999, origin = player })
    player:addMod(xi.mod.DEF, protectionPower)
    player:addMod(xi.mod.MDEF, protectionPower)
    player:addMod(xi.mod.MEVA, protectionPower)
    player:addHP(50000)
    player:setCharVar(stateVar, 1)
end

commandObj.onTrigger = function(player, action)
    action = string.lower(action or '')

    if action == 'status' then
        report(player, string.format(
            'status enabled=%u quest_status=%u cap=%u zone=%u',
            player:getCharVar(stateVar),
            player:getQuestStatus(questLog, questId),
            player:getLevelCap(),
            player:getZoneID()
        ))
        return
    end

    if action == 'off' then
        if player:getCharVar(stateVar) == 1 then
            removeProtection(player)
        end
        report(player, string.format('disabled enabled=0 zone=%u', player:getZoneID()))
        return
    end

    if action ~= 'on' then
        report(player, 'rejected reason=action must be on, off, or status')
        return
    end

    if player:getQuestStatus(questLog, questId) ~= xi.questStatus.QUEST_ACCEPTED then
        report(player, 'rejected reason=In Defiant Challenge is not accepted')
        return
    end

    if player:getLevelCap() ~= 50 then
        report(player, string.format('rejected reason=level cap is %u, expected 50', player:getLevelCap()))
        return
    end

    -- Runtime status effects are cleared by a zone transition while the
    -- persisted charvar remains. Always rebuild protection on `on` so the
    -- caller can explicitly re-arm at a safe arrival point in each zone.
    if player:getCharVar(stateVar) == 1 then
        removeProtection(player)
    end
    addProtection(player)
    report(player, string.format('enabled enabled=1 quest=%u cap=50 zone=%u', questId, player:getZoneID()))
end

return commandObj
