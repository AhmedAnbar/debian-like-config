vim.api.nvim_create_user_command("ToggleDiagnostics", function()
  vim.diagnostic.enable(not vim.diagnostic.is_enabled())
end, {})
