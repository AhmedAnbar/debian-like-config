return {
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope-live-grep-args.nvim",
      "nvim-telescope/telescope-ui-select.nvim",
      "nvim-telescope/telescope-project.nvim",
      "nvim-telescope/telescope-symbols.nvim",
      "nvim-telescope/telescope-fzf-native.nvim",
      "nvim-telescope/telescope-media-files.nvim",
    },
    config = function()
      local telescope = require("telescope")
      local actions = require("telescope.actions")
      telescope.setup({
        defaults = {
          mappings = {
            i = {
              ["<C-k>"] = actions.move_selection_previous,
              ["<C-j>"] = actions.move_selection_next,
              ["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist,
            },
          },
          -- Lua patterns: dots escaped and anchored to path segments, so ".github" or
          -- ".gitignore" are not hidden along with ".git".
          file_ignore_patterns = {
            "^node_modules/", "/node_modules/",
            "^%.git/", "/%.git/",
            "^%.next/", "/%.next/",
            "^_build/", "/_build/",
            "^vendor/", "/vendor/",
            "%.sl/",
            "yarn%.lock$",
          },
          path_display = { "truncate" },
        },
        pickers = {
          -- Include dotfiles (.env.example, .github) while still honouring .gitignore.
          find_files = {
            hidden = true,
            find_command = { "fd", "--type", "f", "--hidden", "--strip-cwd-prefix", "--exclude", ".git" },
          },
          buffers = { sort_mru = true, ignore_current_buffer = true },
        },
        extensions = {
          ["ui-select"] = {
            require("telescope.themes").get_dropdown({}),
          },
          file_browser = {
            hidden = { file_browser = true, folder_browser = true },
            grouped = true,
          },
        },
      })
      require("telescope").load_extension("live_grep_args")
      require("telescope").load_extension("ui-select")
      require("telescope").load_extension("project")
      require("telescope").load_extension("fzf")
      require("telescope").load_extension("media_files")
    end,
    keys = {
      -- Files
      { "<leader>ff", function() require("telescope.builtin").find_files() end, desc = "Find files" },
      { "<leader><leader>", function() require("telescope.builtin").find_files() end, desc = "Find files" },
      { "<leader>fp", function() require("telescope.builtin").git_files({ show_untracked = true }) end, desc = "Find git files" },
      { "<leader>fr", function() require("telescope.builtin").oldfiles({ only_cwd = true }) end, desc = "Recent files" },
      { "<leader>fB", function() require("telescope.builtin").buffers() end, desc = "Open buffers" },
      { "<leader>fb", "<cmd>Telescope file_browser<cr>", desc = "File browser (project)" },
      { "<leader>fe", "<cmd>Telescope file_browser path=%:p:h select_buffer=true<cr>", desc = "File browser (current file)" },
      -- Search
      { "<leader>fg", "<cmd>Telescope live_grep_args<cr>", desc = "Live grep with args" },
      { "<leader>fw", function() require("telescope.builtin").grep_string() end, desc = "Grep word under cursor", mode = { "n", "x" } },
      { "<leader>f/", function() require("telescope.builtin").current_buffer_fuzzy_find() end, desc = "Search in buffer" },
      { "<leader>fo", function() require("telescope.builtin").lsp_document_symbols() end, desc = "Document symbols" },
      { "<leader>fO", function() require("telescope.builtin").lsp_dynamic_workspace_symbols() end, desc = "Workspace symbols" },
      -- Misc
      { "<leader>f.", function() require("telescope.builtin").resume() end, desc = "Resume last picker" },
      { "<leader>fh", function() require("telescope.builtin").help_tags() end, desc = "Help tags" },
      { "<leader>fk", function() require("telescope.builtin").keymaps() end, desc = "Keymaps" },
      { "<leader>fs", function() require("telescope.builtin").symbols(require("telescope.themes").get_dropdown({ previewer = true })) end, desc = "Insert symbols" },
      { "<leader>ft", "<cmd>TodoTelescope<cr>", desc = "Todo list" },
      { "<leader>fc", "<cmd>Telescope neoclip<cr>", desc = "Clipboard history" },
    },
  },
  {
    "AckslD/nvim-neoclip.lua",
    dependencies = {
      { "nvim-telescope/telescope.nvim" },
    },
    config = function()
      require("neoclip").setup()
    end,
  },
  {
    "nvim-telescope/telescope-file-browser.nvim",
    dependencies = { "nvim-telescope/telescope.nvim", "nvim-lua/plenary.nvim" },
    config = function()
      require("telescope").load_extension("file_browser")
    end,
  },
  {
    "nvim-telescope/telescope-fzf-native.nvim",
    build = "make",
  },
}
