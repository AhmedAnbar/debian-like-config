return {
	-- {
	-- 	"olexsmir/gopher.nvim",
	-- 	event = "VeryLazy",
	-- 	dependencies = {
	-- 		"nvim-lua/plenary.nvim",
	-- 		"nvim-treesitter/nvim-treesitter",
	-- 	},
	-- 	ft = "go",
	-- 	config = function(_, opts)
	-- 		require("gopher").setup(opts)
	-- 	end,
	-- 	build = function()
	-- 		vim.cmd([[silent! GoInstallDeps]])
	-- 	end,
	-- 	keys = {
	-- 		{ "<leader>gie", ":GoIfErr<CR>", desc = "GoIfErr" },
	-- 		{ "<leader>gsj", ":GoTagAdd json<CR>", desc = "Add json struct tags" },
	-- 		{ "<leader>gsy", ":GoTagAdd yaml<CR>", desc = "Add yaml struct tags" },
	-- 	},
	-- },
	{
		"ray-x/go.nvim",
		dependencies = { -- optional packages
			"ray-x/guihua.lua",
			"neovim/nvim-lspconfig",
			"nvim-treesitter/nvim-treesitter",
		},
		config = function()
			require("go").setup({ lsp_cfg = false })
		end,

		ft = { "go", "gomod" },
		-- Install optional Go tools explicitly with :GoInstallBinaries.
	},
}
