-- eclipse.jdt.ls for every Java buffer, with the java-debug, vscode-java-test and Spring
-- Boot bundles from Mason. Install them with :MasonToolsInstall (see plugins/mason.lua).
local M = {}

local function mason_dir()
  return vim.env.MASON or (vim.fn.stdpath("data") .. "/mason")
end

local function share(package, pattern)
  return vim.fn.glob(mason_dir() .. "/share/" .. package .. "/" .. pattern, true, true)
end

local function bundles()
  -- share/ holds each jar twice, a versioned file and an unversioned link to it; jdtls
  -- loads both as separate OSGi bundles if given both, so only the link is taken.
  local list = share("java-debug-adapter", "com.microsoft.java.debug.plugin.jar")
  local excluded = { -- nvim-jdtls README: these two are runtime agents, not bundles
    ["com.microsoft.java.test.runner-jar-with-dependencies.jar"] = true,
    ["jacocoagent.jar"] = true,
  }
  for _, jar in ipairs(share("java-test", "*.jar")) do
    local name = vim.fs.basename(jar)
    if not excluded[name] and not name:match("^com%.microsoft%.java%.test%.plugin%-") then
      table.insert(list, jar)
    end
  end
  local ok, spring_boot = pcall(require, "spring_boot")
  if ok then vim.list_extend(list, spring_boot.java_extensions()) end
  return list
end

-- The wrapper (mvnw/gradlew) or settings file marks the top of a multi-module build; a
-- lone pom.xml or build.gradle comes next, then the repository. A loose .java file with
-- none of these still gets a server, rooted at its own directory.
local function root_dir(bufnr)
  return vim.fs.root(bufnr, { "mvnw", "gradlew", "settings.gradle", "settings.gradle.kts" })
    or vim.fs.root(bufnr, { "pom.xml", "build.gradle", "build.gradle.kts" })
    or vim.fs.root(bufnr, ".git")
    or vim.fs.dirname(vim.api.nvim_buf_get_name(bufnr))
end

M.root_dir = root_dir

local function config_for(bufnr)
  local root = root_dir(bufnr)
  -- jdtls keeps an index per project; two projects that share a directory name must not
  -- share a workspace, so the path's hash is part of the name.
  local workspace = vim.fn.stdpath("cache") .. "/jdtls/" .. vim.fs.basename(root) .. "-"
    .. vim.fn.sha256(root):sub(1, 8)
  local jdtls_bin = vim.fn.exepath("jdtls")
  if jdtls_bin == "" then jdtls_bin = mason_dir() .. "/bin/jdtls" end
  local cmd = { jdtls_bin }
  local lombok = mason_dir() .. "/share/jdtls/lombok.jar"
  if vim.uv.fs_stat(lombok) then table.insert(cmd, "--jvm-arg=-javaagent:" .. lombok) end
  vim.list_extend(cmd, { "-data", workspace })
  return {
    name = "jdtls",
    cmd = cmd,
    root_dir = root,
    capabilities = require("cmp_nvim_lsp").default_capabilities(),
    init_options = { bundles = bundles() },
    settings = {
      java = {
        configuration = { updateBuildConfiguration = "interactive" },
        eclipse = { downloadSources = true },
        maven = { downloadSources = true },
        references = { includeDecompiledSources = true },
        contentProvider = { preferred = "fernflower" },
        signatureHelp = { enabled = true },
        inlayHints = { parameterNames = { enabled = "literals" } },
        sources = { organizeImports = { starThreshold = 9999, staticStarThreshold = 9999 } },
        completion = {
          favoriteStaticMembers = {
            "org.junit.jupiter.api.Assertions.*",
            "org.assertj.core.api.Assertions.*",
            "org.mockito.Mockito.*",
            "org.mockito.ArgumentMatchers.*",
            "org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*",
            "org.springframework.test.web.servlet.result.MockMvcResultMatchers.*",
          },
        },
      },
    },
  }
end

-- Runs a build command from the project root in a terminal split below.
local function run_in_terminal(bufnr, maven_args, gradle_args)
  local root = root_dir(bufnr)
  local command
  if vim.uv.fs_stat(root .. "/mvnw") then
    command = "./mvnw " .. maven_args
  elseif vim.uv.fs_stat(root .. "/gradlew") then
    command = "./gradlew " .. gradle_args
  elseif vim.uv.fs_stat(root .. "/pom.xml") then
    command = "mvn " .. maven_args
  elseif vim.uv.fs_stat(root .. "/build.gradle") or vim.uv.fs_stat(root .. "/build.gradle.kts") then
    command = "gradle " .. gradle_args
  else
    vim.notify("No Maven or Gradle build found above " .. vim.api.nvim_buf_get_name(bufnr), vim.log.levels.WARN)
    return
  end
  vim.cmd("botright 15split")
  vim.cmd.lcd(vim.fn.fnameescape(root))
  vim.cmd.terminal(command)
  vim.cmd.startinsert()
end

local function keymaps(bufnr)
  local jdtls = require("jdtls")
  local function map(mode, lhs, rhs, desc)
    vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, silent = true, desc = "Java: " .. desc })
  end
  map("n", "<leader>jo", jdtls.organize_imports, "organize imports")
  map({ "n", "x" }, "<leader>jv", function() jdtls.extract_variable({ visual = vim.fn.mode() ~= "n" }) end, "extract variable")
  map({ "n", "x" }, "<leader>jc", function() jdtls.extract_constant({ visual = vim.fn.mode() ~= "n" }) end, "extract constant")
  map("x", "<leader>jm", function() jdtls.extract_method({ visual = true }) end, "extract method")
  map("n", "<leader>jt", function() require("jdtls.dap").test_nearest_method() end, "test nearest method")
  map("n", "<leader>jT", function() require("jdtls.dap").test_class() end, "test class")
  map("n", "<leader>ju", jdtls.update_projects_config, "reload pom.xml / build.gradle")
  map("n", "<leader>jr", function() run_in_terminal(bufnr, "spring-boot:run", "bootRun") end, "run Spring Boot app")
  map("n", "<leader>jb", function() run_in_terminal(bufnr, "package", "build") end, "build")
  map("n", "<leader>jx", function() run_in_terminal(bufnr, "test", "test") end, "run all tests")
  if vim.fn.exists(":SpringBoot") == 2 then
    map("n", "<leader>js", "<cmd>SpringBoot<cr>", "beans, endpoints, annotations")
  end
end

local function attach(bufnr)
  if vim.bo[bufnr].buftype ~= "" then return end -- jdt:// class files are handled by jdtls itself
  require("jdtls").start_or_attach(config_for(bufnr))
  keymaps(bufnr)
end

function M.setup()
  -- The plugin loads on the first java FileType, which has already fired for this buffer.
  attach(vim.api.nvim_get_current_buf())
  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("AnbarJdtls", { clear = true }),
    pattern = "java",
    callback = function(event) attach(event.buf) end,
  })
end

return M
