require("dotenv").config();

const express = require("express");
const path = require("path");

const { askNvidia } = require("./nvidia-router");

const actionGateway = require("./tools/action-gateway");

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
  "git.diff": "Reading Git diff..."
};

function truncateToolOutput(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max
    ? text.slice(0, max) + "\n... (truncated)"
    : text;
}

/*
  CHAIN-OF-THOUGHT GUARD (deterministic)

  Some models occasionally leak internal reasoning into the
  visible reply (for example a "thinking process" preamble or
  literal think blocks). This guard strips such content so the
  client only ever sees the final answer. It never modifies
  normal answers.
*/

const THINK_OPEN = String.fromCharCode(60) + "think" + String.fromCharCode(62);
const THINK_CLOSE =
  String.fromCharCode(60) + "/" + "think" + String.fromCharCode(62);

const COT_MARKER =
  /(here'?s a thinking process|thinking process\s*:|let me think|my reasoning\s*:|internal reasoning\s*:|analyze user input|analyzing the user|examine tool results|step \d+\s*:)/i;

function stripChainOfThought(reply) {
  let text = String(reply || "");

  // 1) Remove complete think blocks; if unclosed, drop to the end.
  while (text.includes(THINK_OPEN)) {
    const start = text.indexOf(THINK_OPEN);
    const end = text.indexOf(THINK_CLOSE, start);
    if (end === -1) {
      text = text.slice(0, start);
      break;
    }
    text = text.slice(0, start) + text.slice(end + THINK_CLOSE.length);
  }

  // 2) Remove reasoning preambles. The real answer usually begins at the
  //    next bold markdown header AFTER the matched reasoning header
  //    (the matched text itself may be wrapped in "**...**").
  const markerMatch = text.match(COT_MARKER);
  if (markerMatch && markerMatch.index !== undefined) {
    const searchFrom =
      markerMatch.index + markerMatch[0].length;
    const nextBold = text.indexOf("**", searchFrom);

    if (nextBold !== -1) {
      text = text.slice(nextBold);
    } else {
      // No structured answer found; drop everything from the marker on.
      text = text.slice(0, markerMatch.index);
    }
  }

  return text.trim();
}

function planGitTools(message) {
  const text = String(message || "").toLowerCase();
  const plan = [];

  if (/\bbranch(es)?\b/.test(text)) {
    return ["git.branch"];
  }

  if (
    /\b(commit|commits|commit history|recent commits|commit log|git log|history)\b/.test(text)
  ) {
    return ["git.log"];
  }

  if (
    /\b(changed|changes|change|diff|differences?|modified|unstaged|working tree|dirty|status)\b/.test(text)
  ) {
    return ["git.status", "git.diff"];
  }

  return [];
}

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

    const toolsToRun = planGitTools(message);
    const toolActivity = [];
    let toolContext = "";

    for (const toolName of toolsToRun) {
      const result = await actionGateway.executeTool(toolName);

      toolActivity.push(
        TOOL_ACTIVITY_LABELS[toolName] ||
          "Running " + toolName + "..."
      );

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

    const finalUserContent = toolContext
      ? message.trim() +
        "\n\n" +
        "----- GIT TOOL RESULTS (trusted read-only project context) -----\n" +
        toolContext +
        "----- END GIT TOOL RESULTS -----\n" +
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

      toolsUsed: toolsToRun
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
    const { tool } = req.body;

    if (!tool || typeof tool !== "string") {
      return res.status(400).json({
        success: false,
        error: "Tool name is required"
      });
    }

    // Handlers take no arguments; the repository is fixed to DROP_ROOT,
    // so no client-supplied paths or arguments can reach git.
    const result = await actionGateway.executeTool(tool);

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


