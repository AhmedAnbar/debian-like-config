return {
	{
		"mfussenegger/nvim-dap",
	},
	{
		"leoluz/nvim-dap-go",
		dependencies = { "mfussenegger/nvim-dap" },
		ft = "go",
		config = function(_, opts)
			require("dap-go").setup(opts)
		end,
		keys = {
			{ "<leader>db", "<cmd>DapToggleBreakpoint<cr>", desc = "Toggle Breakpoint" },
			{
				"<leader>dus",
				function()
					local widgets = require("dap.ui.widgets")
					local sidebar = widgets.sidebar(widgets.scopes)
					sidebar.open()
				end,
				desc = "Open Sidebar",
			},
			{
				"<leader>dgt",
				function()
					require("dap-go").debug_test()
				end,
				desc = "Debug Go Test",
			},
			{
				"<leader>dgl",
				function()
					require("dap-go").debug_last()
				end,
				desc = "Debug Last Go Test",
			},
		},
	},
}
