-----------------------------------
-- Self-only reload for the repository-controlled agentspell command.
--
-- This avoids restarting xi_map after an exact allowlist update and exposes
-- no caller-controlled module path or arbitrary Lua execution.
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = '',
}

commandObj.onTrigger = function(player)
    local modulePath = 'scripts/commands/agentspell'
    package.loaded[modulePath] = nil
    local loaded, result = pcall(require, modulePath)
    if not loaded then
        player:printToPlayer(string.format('[AgentReload] failed module=agentspell error=%s', result))
        return
    end

    player:printToPlayer('[AgentReload] reloaded module=agentspell')
end

return commandObj
