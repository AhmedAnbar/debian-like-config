-- SPDX-License-Identifier: GPL-3.0-only
-- Loaded only by notes.sh (nvim -S): after the first :w of a scratch note, ask for a name.
-- input() is synchronous, so the prompt also appears for :wq before Neovim quits;
-- noice.nvim draws it as a floating box. :NoteRename renames the note at any time.
local function is_scratch(path)
    return vim.fn.fnamemodify(path, ':t'):match('^scratch%-?%d*%.md$') ~= nil
end

local function rename(buf)
    local old = vim.api.nvim_buf_get_name(buf)
    local dir = vim.fn.fnamemodify(old, ':h')
    local current = vim.fn.fnamemodify(old, ':t')
    while true do
        local ok, answer = pcall(vim.fn.input, {
            prompt = 'Rename note (Enter keeps ' .. current .. '): ',
            cancelreturn = '',
        })
        -- Ctrl+C raises Keyboard interrupt; treat it like Esc.
        local name = ok and vim.trim(answer) or ''
        if name == '' then return end
        name = name:gsub('/', '-')
        if not name:find('%.') then name = name .. '.md' end
        local new = dir .. '/' .. name
        if new == old then return end
        if vim.uv.fs_stat(new) then
            vim.notify(name .. ' already exists; choose another name.', vim.log.levels.WARN)
        else
            local renamed, err = os.rename(old, new)
            if not renamed then
                vim.notify('Rename failed: ' .. tostring(err), vim.log.levels.ERROR)
                return
            end
            vim.api.nvim_buf_set_name(buf, new)
            -- set_name keeps an unlisted buffer for the old path and marks the new
            -- file as not yet written by this buffer; drop one and fix the other.
            local stale = vim.fn.bufnr(old)
            if stale > 0 and stale ~= buf then vim.api.nvim_buf_delete(stale, {force = true}) end
            vim.api.nvim_buf_call(buf, function() vim.cmd('silent write!') end)
            vim.notify('Saved as ' .. name)
            return
        end
    end
end

vim.api.nvim_create_autocmd('BufWritePost', {
    group = vim.api.nvim_create_augroup('notes_scratchpad_rename', {clear = true}),
    callback = function(event)
        -- Ask once per note: after a rename, or Enter to keep the name, :w just saves.
        if vim.b[event.buf].notes_named or not is_scratch(event.match) then return end
        vim.b[event.buf].notes_named = true
        rename(event.buf)
    end,
})

vim.api.nvim_create_user_command('NoteRename', function()
    rename(vim.api.nvim_get_current_buf())
end, {desc = 'Rename the current note'})
