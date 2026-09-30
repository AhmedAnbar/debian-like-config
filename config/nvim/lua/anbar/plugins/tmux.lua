return {
  {
    'alexghergh/nvim-tmux-navigation', config = function()

    local nvim_tmux_nav = require('nvim-tmux-navigation')

    nvim_tmux_nav.setup {
        disable_when_zoomed = true -- defaults to false
    }

    vim.keymap.set('n', "<C-h>", ":NvimTmuxNavigateLeft<CR>", {desc = "Tmux navigate left", noremap = true, silent = true})
    vim.keymap.set('n', "<C-j>", ":NvimTmuxNavigateDown<CR>", {desc = "Tmux navigate down", noremap = true, silent = true})
    vim.keymap.set('n', "<C-k>", ":NvimTmuxNavigateUp<CR>", {desc = "Tmux navigate up", noremap = true, silent = true})
    vim.keymap.set('n', "<C-l>", ":NvimTmuxNavigateRight<CR>", {desc = "Tmux navigate right", noremap = true, silent = true})
    vim.keymap.set('n', "<C-\\>", nvim_tmux_nav.NvimTmuxNavigateLastActive, {desc = "Tmux navigate last active", noremap = true, silent = true})
    vim.keymap.set('n', "<C-Space>", nvim_tmux_nav.NvimTmuxNavigateNext, {desc = "Tmux navigate next", noremap = true, silent = true})

    end
  }
}
