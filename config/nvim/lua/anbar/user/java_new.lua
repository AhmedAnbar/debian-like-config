-- :SpringNew and :JavaNew create projects, so they exist before any Java file is open.
-- The module itself loads only when one of them runs.
vim.api.nvim_create_user_command("SpringNew", function() require("anbar.java.new").spring_new() end,
  { desc = "New Spring Boot project from start.spring.io" })
vim.api.nvim_create_user_command("JavaNew", function() require("anbar.java.new").java_new() end,
  { desc = "New plain Maven Java project" })
vim.keymap.set("n", "<leader>jn", "<cmd>SpringNew<cr>", { silent = true, desc = "Java: new Spring Boot project" })
