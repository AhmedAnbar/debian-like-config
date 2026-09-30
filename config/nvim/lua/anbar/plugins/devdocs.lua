return {
	{
		"luckasRanarison/nvim-devdocs",
		event = "VeryLazy",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-telescope/telescope.nvim",
			"nvim-treesitter/nvim-treesitter",
		},
		opts = {},
		keys = {
			{ "<leader>dcd", ":DevdocsOpen<cr>", desc = "Open devdocs" },
			{ "<leader>dcf", ":DevdocsOpenCurrentFloat<cr>", desc = "Devdocs Open Current Float" },
			{ "<leader>dct", ":DevdocsToggle<cr>", desc = "Devdocs Toggle" },
			{ "<leader>dco", ":DevdocsOpenFloat<cr>", desc = "Devdocs Open Float" },
		},
	},
}
