return {
	"epwalsh/obsidian.nvim",
	version = "*",
	lazy = true,
	ft = "markdown",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	opts = {
		-- render-markdown.nvim draws checkboxes, bullets and headings; two renderers conflict.
		ui = { enable = false },
		workspaces = {
			{
				name = "personal",
				path = "~/Dropbox/obsidian/personal",
			},
			{
				name = "work",
				path = "~/Dropbox/obsidian/work",
			},
		},
	},
}
