return {
	{
		"folke/noice.nvim",
		cond = function() return #vim.api.nvim_list_uis() > 0 end,
		event = "VeryLazy",
		dependencies = {
			"MunifTanjim/nui.nvim",
			"rcarriga/nvim-notify",
		},
		config = function()
			require("noice").setup({
				presets = {
					bottom_search = true, -- use a classic bottom cmdline for search
					command_palette = true, -- position the cmdline and popupmenu together
					long_message_to_split = true, -- long messages will be sent to a split
					inc_rename = true, -- enables an input dialog for inc-rename.nvim
					lsp_doc_border = false, -- add a border to hover docs and signature help
				},
			})
			vim.keymap.set("n", "<leader>dn", ":NoiceDismiss<CR>", { silent = true, desc = "Dismiss Noice" })
		end,
	},
}
