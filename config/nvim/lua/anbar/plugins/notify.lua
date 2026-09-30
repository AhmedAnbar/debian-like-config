return {
	{
		"rcarriga/nvim-notify",
		event = "VeryLazy",
		config = function()
			if vim.g.anbar_smoke then return end
			local notify = require("notify")
      notify.setup({ background_colour = "#1e1e2e" })

			local filtered_message = { "No information available" }

			-- Override notify function to filter out messages
			---@diagnostic disable-next-line: duplicate-set-field
			vim.notify = function(message, level, opts)
				local merged_opts = vim.tbl_extend("force", {
					on_open = function(win)
						local buf = vim.api.nvim_win_get_buf(win)
						vim.api.nvim_buf_set_option(buf, "filetype", "markdown")
					end,
				}, opts or {})

				for _, msg in ipairs(filtered_message) do
					if message == msg then
						return
					end
				end
				return notify(message, level, merged_opts)
			end

			-- Update colors to use catpuccino colors
			vim.cmd([[
        highlight NotifyERRORBorder guifg=#f38ba8
        highlight NotifyERRORIcon guifg=#f38ba8
        highlight NotifyERRORTitle  guifg=#f38ba8
        highlight NotifyINFOBorder guifg=#89b4fa
        highlight NotifyINFOIcon guifg=#89b4fa
        highlight NotifyINFOTitle guifg=#89b4fa
        highlight NotifyWARNBorder guifg=#fab387
        highlight NotifyWARNIcon guifg=#fab387
        highlight NotifyWARNTitle guifg=#fab387
      ]])
		end,
	},
}
