// ---------------------------------------
// TOM PROJECT WORKSPACE — POC
// ---------------------------------------

// Navigation
const navItems = document.querySelectorAll(".nav-item[data-page]");
const pages = document.querySelectorAll(".page");

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.dataset.page;
    const targetPage = document.getElementById(target);

    if (!targetPage) return;

    navItems.forEach((nav) => nav.classList.remove("active"));
    pages.forEach((page) => page.classList.remove("active"));

    item.classList.add("active");
    targetPage.classList.add("active");
  });
});


// Live clock
function updateClock() {
  const clock = document.getElementById("currentTime");

  if (!clock) return;

  clock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

updateClock();
setInterval(updateClock, 30000);


// ---------------------------------------
// WORKSPACE HEALTH
// ---------------------------------------

const healthButton = document.getElementById("healthCheckButton");
const healthSummary = document.getElementById("healthSummary");
const connections = document.querySelectorAll(".connection");

async function runWorkspaceHealthCheck() {
  healthButton.disabled = true;
  healthButton.textContent = "Checking...";

  healthSummary.textContent =
    "Tom is verifying your project workspace.";

  connections.forEach((connection) => {
    const status = connection.querySelector(".connection-status");

    status.textContent = "Checking";
    status.classList.remove("healthy");
  });

  // POC health verification.
  // We verify that the Tom backend is reachable.
  try {
    const response = await fetch("/");

    if (!response.ok) {
      throw new Error("Tom backend unavailable");
    }

    // For the POC these project connections are simulated.
    // Later each one gets its own real connector health endpoint.
    for (const connection of connections) {
      const status = connection.querySelector(".connection-status");

      await new Promise((resolve) => setTimeout(resolve, 180));

      status.textContent = "Connected";
      status.classList.add("healthy");
    }

    healthSummary.textContent =
      "All configured project services are available.";

  } catch (error) {
    healthSummary.textContent =
      "Workspace verification failed. Check the Tom connection.";

  } finally {
    healthButton.disabled = false;
    healthButton.textContent = "Run Health Check";
  }
}

healthButton.addEventListener("click", runWorkspaceHealthCheck);


// ---------------------------------------
// TOM CHAT — VS Code Codex Panel Integration
// ---------------------------------------

// State
// conversations: array of { id: string, title: string, messages: [{role, content, timestamp}] }
let conversations = [];
let activeConversationId = null;
let collapsed = false;

// Load persisted conversations from localStorage
(function () {
  try {
    const stored = localStorage.getItem("tomConversations");
    if (stored) {
      conversations = JSON.parse(stored);
      // Re-use last active conversation if it exists
      if (conversations.length > 0) {
        activeConversationId = conversations[conversations.length - 1].id;
      }
    }
  } catch (e) {
    conversations = [];
  }
})();

function saveConversations() {
  try {
    localStorage.setItem("tomConversations", JSON.stringify(conversations));
  } catch (e) {
    // Ignore localStorage errors
  }
}

// Backwards compat alias used elsewhere in the file
function saveConversationHistory() {
  saveConversations();
}

function getActiveConversation() {
  return conversations.find(c => c.id === activeConversationId) || null;
}

// Create a brand-new conversation and make it active
// Only called on first message OR explicit New Chat
function createConversation(firstMessageText) {
  const id = "conv-" + Date.now();
  const title = firstMessageText.length > 40
    ? firstMessageText.substring(0, 40).trim() + "…"
    : firstMessageText.trim();
  const conv = { id, title, messages: [], timestamp: new Date().toLocaleString() };
  conversations.push(conv);
  activeConversationId = id;
  saveConversations();
  return conv;
}

// Markdown rendering helpers
function renderMarkdown(content, isTomMessage) {
  if (!content) return "";

  let html = String(content);

  // Handle code blocks (fenced)
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const codeBlock = match.replace(/```/g, "").trim();
    return `<pre><code class="language-text">${escapeHtml(codeBlock)}</code></pre>`;
  });

  // Handle inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);

  // Handle headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Handle bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Handle unordered lists - convert to <ul>
  // Simple: convert lines starting with "- " or "* " to <li>
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');

  // Handle line breaks - convert \n to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

function escapeHtml(unsafe) {
  if (!unsafe) return "";

  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// State management
const panel = document.getElementById("tomPanel");
const toggleButton = document.getElementById("tomCollapse");
const historyToggle = document.getElementById("tomHistoryToggle");
const historyPanel = document.getElementById("tomHistory");
const historyClose = document.getElementById("tomHistoryClose");
const newChatButton = document.getElementById("tomNewChat");
const messagesContainer = document.getElementById("tomMessages");
const inputField = document.getElementById("tomInput");
const sendButton = document.getElementById("tomSendButton");
const responseDisplay = document.getElementById("tomResponse");
const composerForm = document.getElementById("tomComposer");

// Collapse/expand panel
function togglePanel() {
  collapsed = !collapsed;
  panel.classList.toggle("collapsed", collapsed);

  // Adjust body padding when panel collapses
  const mainContent = document.querySelector(".app");
  if (collapsed) {
    mainContent.style.paddingRight = "calc(300px - 22px + 230px)";
    toggleButton.textContent = "❁";
    toggleButton.setAttribute("aria-label", "Expand Tom panel");
  } else {
    mainContent.style.paddingRight = "300px";
    toggleButton.textContent = "❃";
    toggleButton.setAttribute("aria-label", "Collapse Tom panel");
  }
}

toggleButton.addEventListener("click", togglePanel);
panel.setAttribute("role", "complementary");
panel.setAttribute("aria-label", "Tom AI assistant");

// History toggle
let historyVisible = false;
function toggleHistory() {
  historyVisible = !historyVisible;
  historyPanel.style.display = historyVisible ? "block" : "none";
  historyToggle.setAttribute("aria-expanded", historyVisible);
  if (historyVisible) {
    historyToggle.textContent = "◁";
  } else {
    historyToggle.textContent = "◷";
  }
}

historyToggle.addEventListener("click", toggleHistory);
historyClose.addEventListener("click", toggleHistory);
newChatButton.addEventListener("click", () => {
  toggleHistory();
  startNewConversation();
});

// New conversation — only called by "New Chat" button
function startNewConversation() {
  // The current active conversation stays saved (it's already in conversations[])
  // Just clear the active id so next message creates a new one
  activeConversationId = null;
  renderMessages([]);
  renderHistory();
  updateInputState(true);
}
 

// Render conversation history
// Render conversation history sidebar list
function renderHistory() {
  const historyList = document.getElementById("tomHistoryList");
  if (!historyList) return;

  historyList.innerHTML = "";

  if (conversations.length === 0) {
    historyList.innerHTML = '<div class="tom-history-item" style="color:var(--muted)">No previous conversations</div>';
    return;
  }

  // Show most recent first
  conversations.slice().reverse().forEach((conv) => {
    const item = document.createElement("div");
    item.className = "tom-history-item" + (conv.id === activeConversationId ? " active" : "");
    item.innerHTML = `
      <div class="conversation-title" style="font-weight:600;margin-bottom:4px;">${escapeHtml(conv.title || "Conversation")}</div>
      <div class="conversation-preview" style="color:var(--muted);font-size:11px;">${conv.messages?.length > 0 ? `${conv.messages.length} messages` : ""}</div>
    `;
    item.addEventListener("click", () => loadConversation(conv));
    historyList.appendChild(item);
  });
}

function loadConversation(conv) {
  // Make this conversation active
  activeConversationId = conv.id;
  renderMessages(conv.messages || []);
  renderHistory();
  if (historyVisible) toggleHistory();
  updateInputState(true);
}

// Render messages with markdown support
function renderMessages(messages) {
  messagesContainer.innerHTML = "";

  if (messages.length === 0) {
    messagesContainer.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:20px;">Start a conversation by typing a message below.</div>';
    return;
  }

  messages.forEach((msg, msgIndex) => {
    const msgDiv = document.createElement("div");
    msgDiv.className = `tom-message ${msg.role}`;
    msgDiv.setAttribute("role", "alert");
    const msgDir = msg.role === "user" ? "user" : "assistant";

    // Render the content as markdown
    const rendered = renderMarkdown(msg.content, msg.role === "tom");

    msgDiv.innerHTML = `
      <div class="message-content">
        ${rendered}
      </div>
    `;

    // Add small timestamp for Tom messages
    if (msg.role === "tom" && msg.timestamp) {
      const timeSpan = document.createElement("span");
      timeSpan.style.fontSize = "10px";
      timeSpan.style.color = "var(--muted)";
      timeSpan.textContent = ` ${msg.timestamp}`;
      msgDiv.querySelector(".message-content").appendChild(timeSpan);
    }

    messagesContainer.appendChild(msgDiv);
  });

  // Scroll to bottom
  requestAnimationFrame(() => {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: "smooth"
    });
  });
}

// Update input state (enable/disable send)
function updateInputState(enable = true) {
  if (enable) {
    sendButton.disabled = false;
    inputField.disabled = false;
    inputField.focus();
    responseDisplay.textContent = "Tom is ready.";
  } else {
    sendButton.disabled = true;
    inputField.disabled = true;
    responseDisplay.textContent = "Tom is thinking...";
  }
}

// Send message
async function sendMessage() {
  const message = inputField.value.trim();
  if (!message) return;

  // Create conversation on first message if none is active
  let conv = getActiveConversation();
  if (!conv) {
    conv = createConversation(message);
  }

  // Append user message to the active conversation
  const userMsg = {
    role: "user",
    content: message,
    timestamp: new Date().toISOString()
  };
  conv.messages.push(userMsg);
  saveConversations();

  // Re-render all messages in this conversation
  renderMessages(conv.messages);
  renderHistory();

  // Clear input and disable send while waiting
  inputField.value = "";
  sendButton.disabled = true;
  responseDisplay.textContent = "Tom is thinking...";

  // Build history to send: all messages before the one we just added
  // (the history Tom needs to recall the conversation)
  const historyForServer = conv.messages.slice(0, -1).map(m => ({
    role: m.role === "tom" ? "assistant" : m.role,
    content: m.content
  }));

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        history: historyForServer
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Tom request failed");
    }

    const tomReply = data.reply || "Tom returned no response.";

    // Append Tom response to the same conversation
    const tomMsg = {
      role: "tom",
      content: tomReply,
      timestamp: new Date().toISOString()
    };
    conv.messages.push(tomMsg);
    saveConversations();

    // Re-render entire conversation
    renderMessages(conv.messages);
    renderHistory();

  } catch (error) {
    console.error("Tom error:", error);

    const errorMsg = {
      role: "tom",
      content: `Tom connection error: ${error.message}`,
      timestamp: new Date().toISOString()
    };
    conv.messages.push(errorMsg);
    saveConversations();
    renderMessages(conv.messages);
    renderHistory();

  } finally {
    updateInputState(true);
  }
}

// Handle send button click
sendButton.addEventListener("click", sendMessage);

// Handle Enter key: send on Enter, Shift+Enter for newline
inputField.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();

    if (event.shiftKey) {
      // Shift+Enter: insert newline
      const start = inputField.selectionStart;
      const end = inputField.selectionEnd;
      inputField.value =
        inputField.value.substring(0, start) +
        "\n" +
        inputField.value.substring(end);
      inputField.focus();
      inputField.setSelectionRange(start + 1, start + 1);
    } else {
      // Enter: send message
      sendMessage();
    }
  }
});

// Handle paste: preserve markdown formatting
inputField.addEventListener("paste", (event) => {
  const pastedText = (event.clipboardData || window.getSelection().pasteData).getData("text");
  // Don't auto-send on paste, just insert text
  const start = inputField.selectionStart;
  const end = inputField.selectionEnd;
  inputField.value =
    inputField.value.substring(0, start) +
    pastedText +
    inputField.value.substring(end);
  inputField.focus();
  inputField.setSelectionRange(start + pastedText.length, start + pastedText.length);
  event.preventDefault();
});

// Handle input: enable/disable send button based on content
inputField.addEventListener("input", () => {
  const isEmpty = !inputField.value.trim();
  sendButton.disabled = isEmpty;
});

// Handle form submit: prevent default and send message
composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

// Initialize
function initTomPanel() {
  // Set initial height based on available space
  const panelBody = document.querySelector(".tom-panel-body");
  if (panelBody) {
    const headerHeight = document.querySelector(".tom-header")?.offsetHeight || 56;
    const composerHeight = document.querySelector(".tom-composer")?.offsetHeight || 56;
    const historyHeight = document.querySelector(".tom-history")?.offsetHeight || 0;
    panelBody.style.minHeight = `calc(100vh - ${headerHeight + composerHeight + historyHeight + 120}px)`;
  }

  // Render initial history
  renderHistory();

  // Set initial input state
  updateInputState(true);

  // Focus input after a short delay
  setTimeout(() => {
    inputField.focus();
  }, 100);
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTomPanel);
} else {
  initTomPanel();
}