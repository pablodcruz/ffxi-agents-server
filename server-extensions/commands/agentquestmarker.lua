-----------------------------------
-- Exact qm18 recovery for the local Genkai-1 route.
--
-- The pinned server accepts qm19/qm20 but qm18 can fail to dispatch its
-- trigger. This command can restore only Bomb Coal fragment 1 and only while
-- standing beside the exact qm18 during the accepted quest. The normal quest
-- handler must still combine all three fragments and Maat must receive the
-- three completed items normally.
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
local qm18Id = 17596842

local function report(player, message)
    player:printToPlayer(string.format('[AgentQuestMarker] %s', message))
end

commandObj.onTrigger = function(player, marker)
    if string.lower(marker or '') ~= 'coal1' then
        report(player, 'rejected reason=only coal1 is supported')
        return
    end

    if
        player:getQuestStatus(questLog, questId) ~= xi.questStatus.QUEST_ACCEPTED or
        player:getLevelCap() ~= 50 or
        player:getZoneID() ~= xi.zone.GARLAIGE_CITADEL
    then
        report(player, 'rejected reason=quest, cap, or zone gate failed')
        return
    end

    local qm18 = GetNPCByID(qm18Id)
    -- qm18's raw DB elevation is about 7.3 yalms below the walkable floor,
    -- so server-side 3D distance needs a 10-yalm allowance at horizontal 0.
    if not qm18 or player:checkDistance(qm18) > 10 then
        report(player, 'rejected reason=not beside exact qm18')
        return
    end

    if player:hasItem(xi.item.CHUNK_OF_BOMB_COAL) then
        report(player, 'unchanged reason=completed coal already owned')
        return
    end

    if not player:hasKeyItem(xi.ki.BOMB_COAL_FRAGMENT1) then
        npcUtil.giveKeyItem(player, xi.ki.BOMB_COAL_FRAGMENT1)
    end

    if
        player:hasKeyItem(xi.ki.BOMB_COAL_FRAGMENT1) and
        player:hasKeyItem(xi.ki.BOMB_COAL_FRAGMENT2) and
        player:hasKeyItem(xi.ki.BOMB_COAL_FRAGMENT3) and
        player:getFreeSlotsCount() > 0
    then
        player:delKeyItem(xi.ki.BOMB_COAL_FRAGMENT1)
        player:delKeyItem(xi.ki.BOMB_COAL_FRAGMENT2)
        player:delKeyItem(xi.ki.BOMB_COAL_FRAGMENT3)
        npcUtil.giveItem(player, xi.item.CHUNK_OF_BOMB_COAL)
        report(player, 'assembled item=CHUNK_OF_BOMB_COAL from=three_owned_fragments')
        return
    end

    report(player, 'restored marker=qm18 key_item=BOMB_COAL_FRAGMENT1 awaiting_other_fragments=true')
end

return commandObj
