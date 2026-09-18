require("dotenv").config();

const express = require("express");
const path = require("path");

const { askNvidia } = require("./nvidia-router");

const {
  DROP_ROOT,
  listProjectFiles,
  readProjectFile
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

    const messages = [
      {
        role: "system",
        content: TOM_SYSTEM_PROMPT
      },

      ...safeHistory,

      {
        role: "user",
        content: message.trim()
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
      reply: result.content,

      provider: "nvidia-direct",

      model: result.model,

      historyMessages:
        safeHistory.length + 1
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


// ---------------------------------------
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