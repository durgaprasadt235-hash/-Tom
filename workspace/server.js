require("dotenv").config();

const express = require("express");
const path = require("path");

const { askNvidia } = require("./nvidia-router");

const actionGateway = require("./tools/action-gateway");
const activityTracker = require("./plugins/runtime/activity-tracker");
const { planGitTools, planVscodeTools, planFileAnalysis, planEditProposal, planEditApproval } = require("./tools/chat-tool-planner");
const { stripChainOfThought } = require("./tools/response-sanitizer");
const editApprovalStore = require("./tools/edit-approval-store");
const patchValidator = require("./tools/patch-validator");
const { buildProjectContext } = require("./tools/context-builder");

const {
  DROP_ROOT,
  listProjectFiles,
  readProjectFile,
  getProjectFileInfo
} = require("./agent");

const app = express();

app.use(express.json({ limit: "2mb" }));


// ---------------------------------------
// TOM CONFIGURATION
// ---------------------------------------

const PORT = 3001;

const TOM_SYSTEM_PROMPT = `
You are Tom, the AI intelligence layer for this project workspace.

Be concise, accurate, evidence-driven, and project-focused.

Rules:
1. Maintain context from the conversation history provided to you.
2. Treat previous user and assistant messages as part of the same conversation.
3. Do not claim that you executed an action unless the system actually performed it.
4. Do not claim that you modified files unless the system actually modified them.
5. Clearly separate facts from assumptions or inference.
6. When project evidence is provided, ground your answer in that evidence.
7. Never reveal your internal reasoning, thinking process, or analysis steps.
   Provide only your final answer.
8. Do not begin your reply with a reasoning/planning section or heading such as
   "Analyze User Input", "Analysis", "Thinking", "Reasoning", or numbered
   planning steps ("1. Identify...", "2. Examine..."). Do not start a reply
   with phrases like "We need to...", "The user wants...", or "Let's think...".
   Respond with only the final answer, with no scratchpad or preamble.
`.trim();


// ---------------------------------------
// TOM DASHBOARD
// ---------------------------------------

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


// ---------------------------------------
// GIT TOOL SELECTION (deterministic, Phase 2)
// ---------------------------------------
// Small, deterministic matcher: maps a user question to at
// most a few registered Action Gateway tools. Normal questions
// that do not need Git produce an empty plan and go straight
// to the existing chat flow untouched.

const MAX_TOOL_OUTPUT_CHARS = 4000;

const TOOL_ACTIVITY_LABELS = {
  "git.status": "Checking Git status...",
  "git.branch": "Checking Git branches...",
  "git.log": "Reading Git log...",
  "git.diff": "Reading Git diff...",
  "vscode.workspace.info": "Reading VS Code workspace...",
  "vscode.workspace.tree": "Reading VS Code workspace tree...",
  "vscode.file.active": "Reading active VS Code file...",
  "vscode.diagnostics": "Reading VS Code diagnostics...",
  "vscode.file.read": "Reading authorized project file..."
};

function truncateToolOutput(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max
    ? text.slice(0, max) + "\n... (truncated)"
    : text;
}

/*
  CHAIN-OF-THOUGHT GUARD (deterministic, defensive second layer)

  Reasoning suppression is primarily handled at the provider layer
  (TOM_SYSTEM_PROMPT + the NVIDIA request's chat_template_kwargs).
  This is the defensive fallback: it strips any internal-reasoning
  content models leak anyway. See tools/response-sanitizer.js.
*/

// ---------------------------------------
// GENERAL TOM CHAT
// ---------------------------------------

app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    const history = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    if (
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    /*
      public/app.js sends previous messages as:

      {
        role: "user" | "assistant",
        content: "..."
      }

      Validate them before sending them to the model.
    */

    const safeHistory = history
      .filter((item) => {
        return (
          item &&
          (item.role === "user" ||
            item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.trim()
        );
      })
      .map((item) => ({
        role: item.role,
        content: item.content.trim()
      }));

    /*
      PHASE 1: CONTROLLED EDIT APPROVAL (deterministic, explicit human step)

      An explicit approval message ("approve edit <approvalId>") applies a
      previously proposed edit through vscode.file.apply_edit. This never
      writes without a valid, unused, unexpired, path-matching approval
      (enforced by tools/edit-approval-store.js + agent.js writeProjectFile).
      This short-circuits the normal chat/NVIDIA pipeline entirely.
    */

    const editApproval = planEditApproval(message);
    if (editApproval) {
      const pending = editApprovalStore.getApproval(editApproval.approvalId);
      const targetPath = pending ? pending.path : null;
      const applyResult = targetPath
        ? await actionGateway.executeTool("vscode.file.apply_edit", { approvalId: editApproval.approvalId, path: targetPath })
        : { success: false, error: "Unknown or invalid approval" };

      if (!applyResult.success) {
        return res.json({
          reply: "Edit not applied: " + applyResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Applying approved edit..."],
          toolsUsed: ["vscode.file.apply_edit"]
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      return res.json({
        reply:
          "Edit applied to " + applyResult.data.path + ".\n\n" +
          "Rereads confirm " + applyResult.data.bytesWritten + " bytes written." +
          (diagnosticsResult.success
            ? "\n\nCurrent diagnostics: " + diagnosticsResult.data.diagnostics.length + " reported."
            : ""),
        provider: "tom-action-gateway",
        toolActivity: ["Applying approved edit...", "Reading VS Code diagnostics..."],
        toolsUsed: ["vscode.file.apply_edit", "vscode.diagnostics"]
      });
    }

    /*
      PHASE 1B: CONTROLLED EDIT PROPOSAL (deterministic trigger, one model call)

      "Fix ... in <path>" reads the file (+ diagnostics) and asks NVIDIA for
      a MINIMAL structured patch ({"edits":[{"oldText","newText"}]}) only -
      never a full-file rewrite. The patch is validated (tools/patch-validator.js)
      and recorded as a pending approval through vscode.file.propose_edit.
      Nothing is written to disk here. If the model output can't be parsed
      or validated as a safe patch, this fails closed with no fallback to
      full-file replacement.
    */

    const editProposal = planEditProposal(message);
    if (editProposal) {
      const readResult = await actionGateway.executeTool("vscode.file.read", { path: editProposal.path });
      if (!readResult.success) {
        return res.json({
          reply: "Could not propose an edit: " + readResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Reading authorized project file..."],
          toolsUsed: ["vscode.file.read"]
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      const diagnosticsForFile = diagnosticsResult.success
        ? diagnosticsResult.data.diagnostics.filter((d) => d.file === editProposal.path)
        : [];

      const editMessages = [
        {
          role: "system",
          content:
            "You propose a MINIMAL edit to one authorized project file. " +
            "Reply with ONLY JSON of the exact form " +
            "{\"edits\":[{\"oldText\":\"...\",\"newText\":\"...\"}]} - no prose, no markdown fences, " +
            "no commentary, nothing before or after the JSON. " +
            "Each oldText must be copied EXACTLY (verbatim, including whitespace) from the current " +
            "content below and must occur exactly once. Never reproduce the whole file; only include " +
            "the smallest oldText/newText pairs needed for the requested change."
        },
        {
          role: "user",
          content:
            "Request: " + message.trim() + "\n\n" +
            "File: " + editProposal.path + "\n\n" +
            "Current content:\n" + readResult.data.content + "\n\n" +
            "Diagnostics for this file:\n" + JSON.stringify(diagnosticsForFile)
        }
      ];

      const editModelResult = await askNvidia(editMessages, { temperature: 0 });
      if (!editModelResult || !editModelResult.content) {
        throw new Error("NVIDIA returned an empty response");
      }

      let edits;
      try {
        edits = patchValidator.parseModelEdits(editModelResult.content);
      } catch (parseError) {
        return res.json({
          reply: "Proposed patch could not be safely validated.",
          provider: "nvidia-direct",
          model: editModelResult.model,
          toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
          toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
        });
      }

      const proposeResult = await actionGateway.executeTool("vscode.file.propose_edit", {
        path: editProposal.path,
        edits
      });

      if (!proposeResult.success) {
        return res.json({
          reply: "Proposed patch could not be safely validated.",
          provider: "nvidia-direct",
          model: editModelResult.model,
          toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
          toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
        });
      }

      const preview = proposeResult.data.summary
        .map((change) =>
          "- remove: " + truncateToolOutput(change.removed, 200) +
          "\n  add: " + truncateToolOutput(change.added, 200)
        )
        .join("\n");

      return res.json({
        reply:
          "Proposed edit for " + proposeResult.data.path + " (not yet applied).\n" +
          "Approval ID: " + proposeResult.data.approvalId + "\n" +
          "Expires: " + proposeResult.data.expiresAt + "\n\n" +
          "Changes:\n" + preview + "\n\n" +
          "Reply with \"approve edit " + proposeResult.data.approvalId + "\" to apply this exact change.",
        provider: "nvidia-direct",
        model: editModelResult.model,
        approvalId: proposeResult.data.approvalId,
        toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
        toolsUsed: ["vscode.file.read", "vscode.diagnostics", "vscode.file.propose_edit"]
      });
    }

    /*
      IMPORTANT:

      This creates ONE continuous model conversation:

      system
      previous user message
      previous Tom response
      previous user message
      previous Tom response
      ...
      current user message
    */

    /*
      PHASE 2: GIT TOOL SELECTION (deterministic)

      Only tools already registered in the Action Gateway can
      run, and only when the question clearly needs repository
      state. The client never supplies paths and handlers take
      no arguments, so no user text can reach git itself.
      Tool output is passed to Tom as trusted project context,
      never into the visible composer.
    */

    /*
      PHASE 3: FILE ANALYSIS TOOL SELECTION (deterministic)

      When the message names an explicit project-relative path
      (e.g. "analyze web/app/page.tsx"), that file is read through
      vscode.file.read and nothing else is bundled in, so unrelated
      project files are never sent to the model. When the message
      instead refers to the "active"/"current"/"open" file, the
      active path is resolved first via vscode.file.active and then
      read the same way. All path validation, blocked names/
      extensions, traversal, symlink, and size checks are enforced
      by the Action Gateway -> agent.js, never by this planner.
    */

    const filePlan = planFileAnalysis(message);
    // An explicit path takes over the whole plan so an unrelated
    // active-file read isn't bundled in with it.
    const vscodeBaseTools = filePlan && filePlan.mode === "explicit" ? [] : planVscodeTools(message);
    const toolsToRun = [...new Set([...planGitTools(message), ...vscodeBaseTools])];
    const toolActivity = [];
    const toolResults = {};
    let toolContext = "";

    async function runTool(toolName, args) {
      const result = await actionGateway.executeTool(toolName, args);
      toolResults[toolName] = result;
      toolActivity.push(
        TOOL_ACTIVITY_LABELS[toolName] ||
          "Running " + toolName + "..."
      );
      return result;
    }

    for (const toolName of toolsToRun) {
      const result = await runTool(toolName);

      if (result && result.success) {
        toolContext +=
          "Tool: " + toolName + "\n" +
          truncateToolOutput(
            typeof result.data === "string"
              ? result.data
              : JSON.stringify(result.data),
            MAX_TOOL_OUTPUT_CHARS
          ) + "\n";
      } else {
        toolContext +=
          "Tool: " + toolName + " (unavailable: " +
          (result && result.error
            ? result.error
            : "unknown") + ")\n";
      }
    }

    if (filePlan) {
      let targetPath = filePlan.mode === "explicit" ? filePlan.path : null;

      if (filePlan.mode === "active") {
        const activeResult = toolResults["vscode.file.active"] || await runTool("vscode.file.active");
        targetPath = activeResult && activeResult.success && activeResult.data.available
          ? activeResult.data.path
          : null;
      }

      if (targetPath) {
        const readResult = await runTool("vscode.file.read", { path: targetPath });
        if (readResult.success) {
          toolContext +=
            "Tool: vscode.file.read (" + targetPath + ")\n" +
            "Authorized file contents:\n" +
            truncateToolOutput(readResult.data.content, MAX_TOOL_OUTPUT_CHARS) + "\n";
        } else {
          // readResult.error comes from agent.js validation and never
          // contains absolute filesystem paths.
          toolContext += "Tool: vscode.file.read (unavailable: " + readResult.error + ")\n";
        }
      } else if (filePlan.mode === "active") {
        toolContext += "Tool: vscode.file.read (unavailable: no active file reported)\n";
      }
    }

    const toolsUsed = Object.keys(toolResults);

    const finalUserContent = toolContext
      ? message.trim() +
        "\n\n" +
        "----- ACTION GATEWAY RESULTS (trusted read-only project context) -----\n" +
        toolContext +
        "----- END ACTION GATEWAY RESULTS -----\n" +
        "Rules for this answer:\n" +
        "1. Treat the tool results above as authoritative repository facts.\n" +
        "2. Present repository facts as facts (for example a short fact list).\n" +
        "3. Clearly separate those facts from your own explanation or inference.\n" +
        "4. Do not claim you executed anything beyond these read-only checks.\n" +
        "5. Answer the user's question directly. Do NOT narrate or analyze the " +
        "conversation, the instructions, or the tool results. Do NOT start with " +
        "sections like 'Analyze User Input' or any step-by-step reasoning. " +
        "Begin directly with the repository facts."
      : message.trim();

    const messages = [
      {
        role: "system",
        content: TOM_SYSTEM_PROMPT
      },

      ...safeHistory,

      {
        role: "user",
        content: finalUserContent
      }
    ];


    // NVIDIA router automatically tries its configured
    // models until one succeeds.
    const result = await askNvidia(messages);


    if (!result || !result.content) {
      throw new Error(
        "NVIDIA returned an empty response"
      );
    }


    return res.json({
      reply: stripChainOfThought(result.content),

      provider: "nvidia-direct",

      model: result.model,

      historyMessages:
        safeHistory.length + 1,

      toolActivity,

      toolsUsed: toolsUsed
    });

  } catch (error) {
    console.error(
      "[Tom Chat Error]",
      error
    );

    return res.status(503).json({
      error:
        error.message ||
        "Tom intelligence provider unavailable"
    });
  }
});


// ---------------------------------------
// TOM CONTEXT BUILDER (read-only, reuses actionGateway)
// ---------------------------------------

app.post("/context", async (req, res) => {
  try {
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
    const context = await buildProjectContext(paths);
    return res.json(context);
  } catch (error) {
    console.error("[Context Builder Error]", error);
    return res.status(500).json({
      error: error.message || "Context build failed"
    });
  }
});


// ---------------------------------------
// PROJECT INFORMATION
// ---------------------------------------

app.get("/project", (req, res) => {
  try {
    return res.json({
      project: "Project Workspace",

      root: DROP_ROOT,

      files: listProjectFiles()
    });

  } catch (error) {
    console.error(
      "[Project Error]",
      error
    );

    return res.status(500).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// READ AUTHORIZED PROJECT FILE
// ---------------------------------------

app.get("/file", (req, res) => {
  try {
    const filePath = req.query.path;

    if (!filePath) {
      return res.status(400).json({
        error: "File path is required"
      });
    }


    const content =
      readProjectFile(filePath);


    return res.json({
      project: "Project Workspace",

      path: filePath,

      content
    });

  } catch (error) {
    console.error(
      "[File Read Error]",
      error
    );

    return res.status(400).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// TOM FILE ANALYSIS
// ---------------------------------------

app.post(
  "/analyze-file",
  async (req, res) => {
    try {
      const filePath =
        req.body.path;

      const question =
        req.body.question;


      if (!filePath) {
        return res.status(400).json({
          error:
            "File path is required"
        });
      }


      if (
        typeof question !== "string" ||
        !question.trim()
      ) {
        return res.status(400).json({
          error:
            "Question is required"
        });
      }


      /*
        SAFE OVERSIZED-FILE DETECTION

        Never send an entire large file to the model.

        Instead, return a clear "large file" result so the
        client can show:
          "Large file — targeted analysis required"

        This keeps the architecture ready for later
        chunking / indexing / retrieval without changing
        the provider routing or reading the whole file.
      */
      const fileInfo =
        getProjectFileInfo(filePath);

      if (fileInfo.isLarge) {
        return res.status(200).json({
          project:
            "Project Workspace",

          file:
            filePath,

          largeFile:
            true,

          size:
            fileInfo.size,

          maxSize:
            fileInfo.maxSize,

          message:
            "Large file — targeted analysis required",

          reply:
            "Large file — targeted analysis required.\n\n" +
            "This file is " +
            Math.round(fileInfo.size / 1024) +
            " KB, which is above Tom's " +
            Math.round(fileInfo.maxSize / 1024) +
            " KB full-analysis limit. Tom will not send " +
            "the entire file to the model.\n\n" +
            "Targeted analysis (chunking / retrieval) is " +
            "required for this file.",

          provider:
            "nvidia-direct",

          model:
            null
        });
      }


      const content =
        readProjectFile(filePath);


      const analysisPrompt = `
Project root:
${DROP_ROOT}

File being inspected:
${filePath}

The following is the actual content of the authorized project file.

----- FILE START -----

${content}

----- FILE END -----

User request:

${question.trim()}

File analysis rules:

1. Analyze only what is supported by the provided source code.
2. Clearly separate facts from inference.
3. Do not claim that you modified files.
4. Do not claim that you executed commands.
5. Do not invent project architecture not supported by the source.
6. If additional files are required, identify the specific files Tom should inspect next.
7. Keep the response focused on the user's request.
`.trim();


      const messages = [
        {
          role: "system",
          content:
            TOM_SYSTEM_PROMPT
        },

        {
          role: "user",
          content:
            analysisPrompt
        }
      ];


      const result =
        await askNvidia(messages);


      if (
        !result ||
        !result.content
      ) {
        throw new Error(
          "NVIDIA returned an empty response"
        );
      }


      return res.json({
        project:
          "Project Workspace",

        file:
          filePath,

        reply:
          result.content,

        provider:
          "nvidia-direct",

        model:
          result.model
      });

    } catch (error) {
      console.error(
        "[Tom File Analysis Error]",
        error
      );

      return res.status(503).json({
        error:
          error.message ||
          "Tom file analysis unavailable"
      });
    }
  }
);


// ---------------------------------------
// TOM ACTION GATEWAY
// ---------------------------------------

// Get all registered tools and their metadata
app.get("/tools", (req, res) => {
  try {
    const capabilityFilter = req.query.capability || null;
    const tools = actionGateway.getRegisteredTools(capabilityFilter);
    return res.json({
      success: true,
      tools: tools,
      count: tools.length
    });
  } catch (error) {
    console.error("[Action Gateway Error]", error);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve registered tools"
    });
  }
});

// Execute a registered tool
app.post("/tools/execute", async (req, res) => {
  try {
    const { tool, args } = req.body;

    if (!tool || typeof tool !== "string") {
      return res.status(400).json({
        success: false,
        error: "Tool name is required"
      });
    }

    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      return res.status(400).json({
        success: false,
        error: "Tool args must be a plain object"
      });
    }

    // Only tools that declare requiresArgs (e.g. vscode.file.read) use client-
    // supplied args, and those args still pass through the shared DROP project
    // path validation (validateProjectPath/readProjectFile) before any file is
    // touched. Zero-argument tools like git.* ignore anything supplied here.
    const result = await actionGateway.executeTool(tool, args);

    if (result.success) {
      return res.json(result);
    } else {
      // Tool not found or execution failed
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("[Action Gateway Execute Error]", error);
    return res.status(500).json({
      success: false,
      tool: req.body.tool || "unknown",
      error: "Internal gateway error"
    });
  }
});


// ---------------------------------------
// TOM BACKEND HEALTH
// ---------------------------------------

app.get("/health", (req, res) => {
  const nvidiaConfigured =
    Boolean(
      process.env.NVIDIA_API_KEY
    );


  return res
    .status(
      nvidiaConfigured
        ? 200
        : 503
    )
    .json({
      status:
        nvidiaConfigured
          ? "ok"
          : "degraded",

      tomServer:
        "connected",

      intelligenceGateway:
        nvidiaConfigured
          ? "configured"
          : "missing-api-key",

      provider:
        "nvidia-direct",

      router:
        "enabled",

      project:
        "DROP",

      projectRoot:
        DROP_ROOT
    });
});




// ---------------------------------------
// PLUGIN MARKETPLACE API - PART 1
// Catalog, categories, search
// ---------------------------------------
const pluginRegistry = require('./plugins/registry/plugin-registry');
const pluginManager = require('./plugins/runtime/plugin-manager');
const projectRegistry = require('./plugins/runtime/project-registry');
const vscodeBridge = require('./plugins/vscode/vscode-bridge');

function requireKnownProject(req, res, next) {
  if (!projectRegistry.validateProjectId(req.params.projectId)) {
    return res.status(404).json({ error: 'project_not_found' });
  }
  next();
}

function requireKnownPlugin(req, res, next) {
  if (!pluginRegistry.validatePluginId(req.params.pluginId)) {
    return res.status(404).json({ error: 'plugin_not_found' });
  }
  next();
}

function requireVSCodePlugin(req, res, next) {
  if (!pluginRegistry.validatePluginId('vscode')) {
    return res.status(404).json({ error: 'plugin_not_found' });
  }
  next();
}

app.use('/projects/:projectId/plugins', requireKnownProject);

function pluginStatus(projectId, pluginId) {
  const state = pluginManager.getPluginStatus(projectId, pluginId);
  if (pluginId !== 'vscode' || !state.installed) return state;
  const connection = vscodeBridge.getConnection(projectId);
  return {
    ...state,
    status: !state.enabled
      ? 'disabled'
      : connection.connected
      ? 'connected'
      : (state.enabled ? 'disconnected' : 'configuration_required'),
    connection: state.enabled
      ? connection
      : { ...connection, connected: false, status: 'disabled' }
  };
}

async function requireEnabledVSCodeBridge(req, res, next) {
  try {
    if (!pluginRegistry.validatePluginId('vscode')) {
      return res.status(404).json({ error: 'plugin_not_found' });
    }

    const state = pluginManager.getPluginStatus(req.params.projectId, 'vscode');
    if (!state.installed || !state.enabled) {
      return res.status(409).json({ error: 'vscode_plugin_not_enabled' });
    }

    const detection = await vscodeBridge.detectVSCode();
    if (!detection.installedLocally && !detection.cliAvailable && !detection.bundledCliAvailable) {
      return res.status(503).json({ error: 'vscode_not_installed' });
    }

    next();
  } catch (error) {
    res.status(503).json({ error: 'vscode_unavailable' });
  }
}

app.get('/projects/:projectId/plugins/vscode/bridge/challenge', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(vscodeBridge.beginHandshake(req.params.projectId));
  } catch (error) {
    res.status(error.message === 'project_not_found' ? 404 : 400).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/handshake', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    const connection = vscodeBridge.acceptHandshake(req.params.projectId, req.body);
    res.set('Cache-Control', 'no-store').json({ connection });
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/heartbeat', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    const connection = vscodeBridge.heartbeat(req.params.projectId, req.body);
    res.set('Cache-Control', 'no-store').json({ connection });
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/disconnect', requireKnownProject, requireVSCodePlugin, (req, res) => {
  try {
    const result = vscodeBridge.disconnect(req.params.projectId, req.body && req.body.sessionId, req.body && req.body.clientInstanceId);
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});


// Topology is a read-only projection; it never writes plugin configuration.
app.get('/projects/:projectId/topology', requireKnownProject, (req, res) => {
  try {
    const { buildTopologySnapshot } = require('./plugins/runtime/topology-model');
    const snapshot = buildTopologySnapshot(req.params.projectId, {
      projectRegistry, pluginRegistry, pluginManager, vscodeBridge, actionGateway
      , activityTracker
    });
    if (!snapshot) return res.status(404).json({ error: 'project_not_found' });
    res.set('Cache-Control', 'no-store').json(snapshot);
  } catch (error) {
    res.status(500).json({ error: 'topology_unavailable' });
  }
});

// GET /plugins - Get full catalog
app.get('/plugins', (req, res) => {
  try {
    const catalog = pluginRegistry.getCatalog();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/categories - Get available categories
app.get('/plugins/categories', (req, res) => {
  try {
    const categories = pluginRegistry.getCategories();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/search - Search plugins
app.get('/plugins/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const results = pluginRegistry.searchPlugins(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/:id - Get single plugin by ID
app.get('/plugins/:id', (req, res) => {
  try {
    const plugin = pluginRegistry.getPluginById(req.params.id);
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    res.json(plugin);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---------------------------------------

// ---------------------------------------
// PLUGIN MARKETPLACE API - PART 2
// Project-scoped plugin management
// ---------------------------------------
// GET /projects/:projectId/plugins - Get installed plugins for a project
app.get('/projects/:projectId/plugins', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const installed = pluginManager.getInstalledPlugins(projectId);
    const enabled = pluginManager.getEnabledPlugins(projectId);

    const catalog = pluginRegistry.getCatalog();
    const projectPlugins = catalog.filter(p => installed.includes(p.id));

    const pluginsWithStatus = projectPlugins.map(plugin => {
      const statusInfo = pluginStatus(projectId, plugin.id);
      return {
        ...plugin,
        installed: statusInfo.installed,
        enabled: statusInfo.enabled,
        status: statusInfo.status
      };
    });

        res.json(pluginsWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /projects/:projectId/plugins/:pluginId/status - Get plugin status
app.get('/projects/:projectId/plugins/:pluginId/status', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    if (!pluginRegistry.validatePluginId(pluginId)) {
      return res.status(404).json({ error: 'Plugin not found in catalog' });
    }

    const statusInfo = pluginStatus(projectId, pluginId);
    const plugin = pluginRegistry.getPluginById(pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/install - Install a plugin
app.post('/projects/:projectId/plugins/:pluginId/install', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    if (!pluginRegistry.validatePluginId(pluginId)) {
      return res.status(404).json({ error: 'Plugin not found in catalog' });
    }

    const result = pluginManager.installPlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/uninstall - Uninstall a plugin
app.post('/projects/:projectId/plugins/:pluginId/uninstall', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.uninstallPlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/enable - Enable a plugin
app.post('/projects/:projectId/plugins/:pluginId/enable', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.enablePlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/disable - Disable a plugin
app.post('/projects/:projectId/plugins/:pluginId/disable', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.disablePlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---------------------------------------
// DASHBOARD FALLBACK
// ---------------------------------------

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

// START TOM
// ---------------------------------------

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");

    console.log(
      `Tom Project Workspace running on port ${PORT}`
    );

    console.log(
      `Authorized project: ${DROP_ROOT}`
    );

    console.log(
      "Intelligence gateway: NVIDIA Direct"
    );

    console.log(
      "NVIDIA model failover router: enabled"
    );

    console.log("");
  }
);
