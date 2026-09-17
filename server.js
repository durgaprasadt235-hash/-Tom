const express = require("express");
const path = require("path");

const {
  DROP_ROOT,
  listProjectFiles,
  readProjectFile
} = require("./agent");

const app = express();

app.use(express.json());

// ---------------------------------------
// TOM CONFIGURATION
// ---------------------------------------

const OMNIROUTE_URL = "http://127.0.0.1:20128";
const MODEL = "my-combo";


// ---------------------------------------
// TOM DASHBOARD
// ---------------------------------------

// Serve everything inside /public
app.use(express.static(path.join(__dirname, "public")));


// ---------------------------------------
// GENERAL TOM CHAT
// ---------------------------------------

app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const response = await fetch(
      `${OMNIROUTE_URL}/v1/chat/completions`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: MODEL,

          messages: [
            {
              role: "system",
              content:
                "You are Tom, the AI intelligence layer for this project workspace. Be concise, accurate, evidence-driven, and project-focused. Do not claim that you executed an action unless the system actually performed it."
            },
            {
              role: "user",
              content: message.trim()
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    return res.json({
      reply:
        data.choices?.[0]?.message?.content ||
        "No response"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
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

    const content = readProjectFile(filePath);

    return res.json({
      project: "Project Workspace",
      path: filePath,
      content
    });

  } catch (error) {
    return res.status(400).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// TOM FILE ANALYSIS
// ---------------------------------------

app.post("/analyze-file", async (req, res) => {
  try {
    const filePath = req.body.path;
    const question = req.body.question;

    if (!filePath) {
      return res.status(400).json({
        error: "File path is required"
      });
    }

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Question is required"
      });
    }

    const content = readProjectFile(filePath);

    const prompt = `
You are Tom, the AI intelligence layer for an authorized software project workspace.

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

Rules:

1. Analyze only what is supported by the provided source code.
2. Clearly separate facts from inference.
3. Do not claim that you modified files.
4. Do not claim that you executed commands.
5. Do not invent project architecture that is not supported by the source.
6. If additional project files are required, identify the specific files or types of files Tom should inspect next.
7. Keep the response focused on the user's request.
`;

    const response = await fetch(
      `${OMNIROUTE_URL}/v1/chat/completions`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: MODEL,

          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    return res.json({
      project: "Project Workspace",
      file: filePath,

      reply:
        data.choices?.[0]?.message?.content ||
        "No response"
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// TOM BACKEND HEALTH
// ---------------------------------------

app.get("/health", async (req, res) => {
  try {
    const response = await fetch(
      `${OMNIROUTE_URL}/v1/models`
    );

    return res.json({
      tomServer: "connected",
      intelligenceGateway:
        response.ok ? "connected" : "degraded",
      model: MODEL
    });

  } catch (error) {
    return res.status(503).json({
      tomServer: "connected",
      intelligenceGateway: "disconnected",
      model: MODEL
    });
  }
});


// ---------------------------------------
// DASHBOARD FALLBACK
// ---------------------------------------

app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


// ---------------------------------------
// START TOM
// ---------------------------------------

app.listen(
  3001,
  "0.0.0.0",
  () => {
    console.log("");
    console.log("Tom Project Workspace running on port 3001");
    console.log(`Authorized project: ${DROP_ROOT}`);
    console.log(`Intelligence gateway: OmniRoute`);
    console.log(`Model route: ${MODEL}`);
    console.log("");
  }
);