return {
	{
		"mfussenegger/nvim-dap",
		-- Debugger keys for every language with an adapter (Go via nvim-dap-go, Java via
		-- nvim-jdtls). F5 also starts a session: for Java it offers the main classes found.
		keys = {
			{ "<F5>", function() require("dap").continue() end, desc = "Debug: start / continue" },
			{ "<F9>", function() require("dap").toggle_breakpoint() end, desc = "Debug: toggle breakpoint" },
			{ "<F10>", function() require("dap").step_over() end, desc = "Debug: step over" },
			{ "<F11>", function() require("dap").step_into() end, desc = "Debug: step into" },
			{ "<F12>", function() require("dap").step_out() end, desc = "Debug: step out" },
			{ "<S-F5>", function() require("dap").terminate() end, desc = "Debug: stop" },
			{ "<leader>dR", function() require("dap").repl.toggle() end, desc = "Debug: toggle REPL" },
		},
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
