return {
	{
		"tpope/vim-fugitive",
	},
	{
		"lewis6991/gitsigns.nvim",
    event = "VeryLazy",
		config = function()
			require("gitsigns").setup({
				current_line_blame = true,
				on_attach = function(bufnr)
					local gs = package.loaded.gitsigns

					local function map(mode, l, r, opts)
						opts = opts or {}
						opts.buffer = bufnr
						vim.keymap.set(mode, l, r, opts)
					end

					-- Navigation
					map("n", "]c", function()
						if vim.wo.diff then
							return "]c"
						end
						vim.schedule(function()
							gs.next_hunk()
						end)
						return "<Ignore>"
					end, { expr = true })

					map("n", "[c", function()
						if vim.wo.diff then
							return "[c"
						end
						vim.schedule(function()
							gs.prev_hunk()
						end)
						return "<Ignore>"
					end, { expr = true })

					-- Actions
					map("n", "<leader>hs", gs.stage_hunk, { silent = true, desc = "Stage hunk" })
					map("n", "<leader>hr", gs.reset_hunk, { silent = true, desc = "Reset hunk" })
					map("v", "<leader>hs", function()
						gs.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
					end, { silent = true, desc = "Stage hunk" })
					map("v", "<leader>hr", function()
						gs.reset_hunk({ vim.fn.line("."), vim.fn.line("v") })
					end, { silent = true, desc = "Reset hunk" })
					map("n", "<leader>hS", gs.stage_buffer, { silent = true, desc = "Stage buffer" })
					map("n", "<leader>hu", gs.undo_stage_hunk, { silent = true, desc = "Undo stage hunk" })
					map("n", "<leader>hR", gs.reset_buffer, { silent = true, desc = "Reset buffer" })
					map("n", "<leader>hp", gs.preview_hunk, { silent = true, desc = "Preview hunk" })
					map("n", "<leader>hb", function()
						gs.blame_line({ full = true })
					end, { silent = true, desc = "Blame line" })
					map("n", "<leader>tb", gs.toggle_current_line_blame, { silent = true, desc = "Toggle blame line" })
					map("n", "<leader>hd", gs.diffthis, { silent = true, desc = "Diff this" })
					map("n", "<leader>hD", function()
						gs.diffthis("~")
					end, { silent = true, desc = "Diff all" })
					map("n", "<leader>td", gs.preview_hunk_inline, { silent = true, desc = "Toggle deleted" })
					map("n", "<leader>ta", gs.toggle_linehl, { silent = true, desc = "Toggle added" })

					-- Text object
					map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>")
				end,
			})
		end,
	},
	{
		"kdheepak/lazygit.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		keys = {
			{ "<leader>gg", ":LazyGit<CR>", desc = "LazyGit", silent = true },
		},
	},
}
