return {
	{
		"nvim-treesitter/nvim-treesitter",
    branch = "master", -- Preserve the legacy API used by textobjects/devdocs.
    lazy = false,
		build = function()
			require("nvim-treesitter.install").update({ with_sync = true })
		end,

		dependencies = {
			"JoosepAlviste/nvim-ts-context-commentstring",
			{ "nvim-treesitter/nvim-treesitter-textobjects", branch = "master" },
			"windwp/nvim-ts-autotag",
		},
		config = function(_, opts)
			require("anbar.user.treesitter_compat").setup()
			require("nvim-ts-autotag").setup({
        opts = { enable_close = true, enable_rename = true, enable_close_on_slash = true },
      })
			local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
			parser_config.blade = {
				install_info = {
					url = "https://github.com/EmranMR/tree-sitter-blade",
					files = { "src/parser.c" },
					branch = "main",
				},
				filetype = "blade",
			}
			vim.g.skip_ts_context_commentstring_module = true

			local configs = require("nvim-treesitter.configs")
			configs.setup({
				auto_install = false,
				ensure_installed = {
					"lua",
					"vim",
					"vimdoc",
					"javascript",
					"html",
					"css",
					"scss",
					"jsonc",
					"regex",
					"prisma",
					"svelte",
					"php", "json", "blade", "typescript", "tsx", "go", "rust", "markdown", "markdown_inline",
				},
				sync_install = false,
				autopairs = { enable = true },
				highlight = { enable = true },
				indent = { enable = true },
				incremental_selection = {
					enable = true,
					keymaps = {
						init_selection = "<c-space>",
						node_incremental = "<c-space>",
						scope_incremental = "<c-s>",
						node_decremental = "<c-backspace>",
					},
				},
				textobjects = {
					select = {
						enable = true,
						lookahead = true, -- Automatically jump forward to textobj, similar to targets.vim
						keymaps = {
							-- You can use the capture groups defined in textobjects.scm
							["aa"] = "@parameter.outer",
							["ia"] = "@parameter.inner",
							["af"] = "@function.outer",
							["if"] = "@function.inner",
							["ac"] = "@class.outer",
							["ic"] = "@class.inner",
						},
					},
					move = {
						enable = true,
						set_jumps = true, -- whether to set jumps in the jumplist
						goto_next_start = {
							["]m"] = "@function.outer",
							["]]"] = "@class.outer",
						},
						goto_next_end = {
							["]M"] = "@function.outer",
							["]["] = "@class.outer",
						},
						goto_previous_start = {
							["[m"] = "@function.outer",
							["[["] = "@class.outer",
						},
						goto_previous_end = {
							["[M"] = "@function.outer",
							["[]"] = "@class.outer",
						},
					},
				},
			})
		end,
	},
}
