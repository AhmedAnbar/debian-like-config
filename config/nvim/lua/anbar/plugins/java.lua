-- Java and Spring Boot. eclipse.jdt.ls is started by nvim-jdtls rather than nvim-lspconfig,
-- because jdtls needs a workspace directory per project and its extension bundles (the
-- debugger, the test runner and Spring Boot's) to be wired in at start. The setup lives in
-- lua/anbar/java/ so lazy.nvim does not import it as a plugin spec.
return {
  {
    "mfussenegger/nvim-jdtls",
    ft = "java",
    dependencies = {
      "mason-org/mason.nvim",
      "mfussenegger/nvim-dap", -- nvim-jdtls registers the java adapter only if dap is loaded first
      "hrsh7th/cmp-nvim-lsp",
    },
    config = function() require("anbar.java").setup() end,
  },
  {
    -- Bean, endpoint and application.properties/yml intelligence. It needs Neovim 0.12
    -- (Ubuntu 26.04's apt package is 0.11.6); without it jdtls still runs, minus Spring.
    "JavaHello/spring-boot.nvim",
    cond = vim.fn.has("nvim-0.12") == 1,
    ft = { "java", "yaml", "jproperties" },
    dependencies = { "mason-org/mason.nvim" },
    opts = {
      -- Only start the Spring server in projects that depend on Spring Boot, so plain
      -- Java and unrelated YAML do not pay for a second JVM.
      project_filter = function(root_dir)
        return require("spring_boot.util").has_spring_boot_dependency(root_dir)
      end,
    },
  },
}
