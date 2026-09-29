-- Renders Markdown inside the buffer: styled in normal mode, raw while inserting.
return {
	"MeanderingProgrammer/render-markdown.nvim",
	ft = "markdown",
	dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
	opts = {
		-- No latex or yaml parsers are installed; those blocks stay plain instead of warning.
		latex = { enabled = false },
		yaml = { enabled = false },
	},
	keys = {
		{ "<leader>md", "<cmd>RenderMarkdown toggle<cr>", ft = "markdown", desc = "Toggle Markdown rendering" },
	},
}
