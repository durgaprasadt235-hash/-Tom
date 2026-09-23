// ---------------------------------------
// TOM PROJECT WORKSPACE — POC
// ---------------------------------------

// Navigation
const navItems = document.querySelectorAll(".nav-item[data-page]");
const pages = document.querySelectorAll(".page");

function activatePage(target, activeTarget = target) {
  const targetPage = document.getElementById(target);
  if (!targetPage) return;

  navItems.forEach((nav) => {
    nav.classList.toggle("active", nav.dataset.page === activeTarget);
  });
  pages.forEach((page) => page.classList.toggle("active", page === targetPage));
  document.body.classList.toggle("command-page", target === "command");

  if (target === "workspace" && !workspaceLoaded) loadWorkspace();
  if (target === "marketplace") {
    if (!marketplaceAllPlugins.length) loadMarketplace();
    else handleMarketplaceSearch();
  }
  if (target === "installed" || target === "topology") {
    if (!marketplaceAllPlugins.length) loadMarketplace();
    else refreshProjectPluginViews();
  }

  if (mobileLayout.matches) closeMobileDrawers();
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    activatePage(item.dataset.page);
  });
});

document.querySelectorAll("[data-open-page]").forEach((button) => {
  button.addEventListener("click", () => {
    activatePage(button.dataset.openPage, "marketplace");
  });
});

const sidebarNewTask = document.getElementById("sidebarNewTask");
if (sidebarNewTask) {
  sidebarNewTask.addEventListener("click", () => {
    startNewConversation();
    activatePage("command");
  });
}

const sidebarAskTom = document.getElementById("sidebarAskTom");
if (sidebarAskTom) {
  sidebarAskTom.addEventListener("click", () => activatePage("command"));
}

document.querySelectorAll("[data-home-page]").forEach((button) => {
  button.addEventListener("click", () => activatePage(button.dataset.homePage));
});

const intelligenceTabs = document.querySelectorAll(".intelligence-tab");
const intelligencePanels = document.querySelectorAll(".intelligence-panel");

intelligenceTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const targetTab = tab.dataset.tab;

    intelligenceTabs.forEach((item) => {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-selected", String(item === tab));
    });

    intelligencePanels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === targetTab);
    });
  });
});

// Live clock
function updateClock() {
  const clock = document.getElementById("currentTime");
  const date = document.getElementById("currentDate");

  if (!clock && !date) return;

  const now = new Date();

  if (clock) {
    clock.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (date) {
    date.textContent = now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }
}

updateClock();
setInterval(updateClock, 30000);


// ---------------------------------------
// WORKSPACE HEALTH
// ---------------------------------------

const healthButton = document.getElementById("healthCheckButton");
const healthSummary = document.getElementById("healthSummary");
const connections = document.querySelectorAll(".health-row");

async function runWorkspaceHealthCheck() {
  healthButton.disabled = true;
  healthButton.textContent = "Checking...";

  healthSummary.textContent = "Checking workspace connections...";

  connections.forEach((connection) => {
    const status = connection.querySelector(".connection-status");
    status.textContent = "Checking...";
  });

  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error("Workspace health unavailable");
    }

    const health = await response.json();
    const summaryText = health.status === "ok"
      ? "Workspace healthy"
      : "Workspace degraded";

    healthSummary.textContent = summaryText;

    const rows = Array.from(document.querySelectorAll(".health-row"));
    const rowMap = new Map(rows.map((row) => [row.dataset.connection, row]));

    const updateRow = (label, connected, detail) => {
      const row = rowMap.get(label);
      if (!row) return;
      const status = row.querySelector(".connection-status");
      status.textContent = connected ? "Connected" : detail;
      status.classList.toggle("warning", !connected);
      status.classList.toggle("healthy", connected);
    };

    updateRow("Development Environment", health.project?.connected, health.project?.connected ? "Project connected" : "Not connected");
  updateRow("NVIDIA Direct", health.providers?.nvidiaDirect?.configured, health.providers?.nvidiaDirect?.configured ? "NVIDIA Direct configured" : "Missing NVIDIA configuration");
    updateRow("File Server", health.providers?.vscode?.connected, health.providers?.vscode?.connected ? "VS Code bridge connected" : "VS Code disconnected");

    ["Source Database", "Message Queue", "Scheduler"].forEach((label) => {
      const row = rowMap.get(label);
      if (!row) return;
      row.querySelector(".connection-status").textContent = "Not configured";
      row.querySelector(".connection-status").classList.add("neutral");
    });

  } catch (error) {
    healthSummary.textContent = "Workspace health unavailable";
    connections.forEach((connection) => {
      const status = connection.querySelector(".connection-status");
      status.textContent = "Unavailable";
    });
  } finally {
    healthButton.disabled = false;
    healthButton.textContent = "Run Health Check";
  }
}

if (healthButton) {
  healthButton.addEventListener("click", runWorkspaceHealthCheck);
}


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
  const conv = {
    id,
    title,
    messages: [],
    timestamp: new Date().toLocaleString(),
    lastActivity: Date.now()
  };
  conversations.push(conv);
  activeConversationId = id;
  saveConversations();
  return conv;
}

// Human-friendly "last activity" label for the history list.
function formatLastActivity(conv) {
  const stamp = conv.lastActivity || conv.timestamp;
  if (!stamp) return "";

  const date = new Date(stamp);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

// Markdown rendering helpers
// Renders normal text, headings, bullet lists, numbered lists,
// inline code and fenced code blocks (with a Copy button).
// Only renders what Tom/user wrote; hidden reasoning is never added.
function inlineFormat(str) {
  return String(str).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderCodeBlock(block) {
  const lang = block.lang ? escapeHtml(block.lang) : "text";
  const code = escapeHtml(block.code);

  return (
    '<div class="code-block">' +
      '<div class="code-block-header">' +
        '<span class="code-lang">' + lang + "</span>" +
        '<button class="code-copy" type="button">Copy</button>' +
      "</div>" +
      '<pre><code class="language-' + lang + '">' + code + "</code></pre>" +
    "</div>"
  );
}

function renderMarkdown(content) {
  if (!content) return "";

  let text = String(content).replace(/\r\n/g, "\n");

  // 1) Protect fenced code blocks before anything else.
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (match, body) => {
    let code = body.replace(/^\n/, "").replace(/\n$/, "");
    let lang = "";

    const langMatch = code.match(/^([a-zA-Z0-9_+#.-]+)[ \t]*\n/);
    if (langMatch) {
      lang = langMatch[1];
      code = code.slice(langMatch[0].length);
    }

    codeBlocks.push({ lang, code });
    return "\n\u0000CODE" + (codeBlocks.length - 1) + "\u0000\n";
  });

  // 2) Escape everything that is left.
  text = escapeHtml(text);

  // 3) Inline code.
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // 4) Line-based block parsing.
  const lines = text.split("\n");
  const html = [];
  let listOpen = null;

  const closeList = () => {
    if (listOpen) {
      html.push(listOpen === "ul" ? "</ul>" : "</ol>");
      listOpen = null;
    }
  };

  for (const line of lines) {
    const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/);

    if (codeMatch) {
      closeList();
      const block = codeBlocks[Number(codeMatch[1])];
      if (block) html.push(renderCodeBlock(block));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(
        "<h" + level + ">" + inlineFormat(heading[2]) + "</h" + level + ">"
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      if (listOpen !== "ul") {
        closeList();
        html.push("<ul>");
        listOpen = "ul";
      }
      html.push("<li>" + inlineFormat(bullet[1]) + "</li>");
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (listOpen !== "ol") {
        closeList();
        html.push("<ol>");
        listOpen = "ol";
      }
      html.push("<li>" + inlineFormat(numbered[1]) + "</li>");
      continue;
    }

    closeList();

    if (line.trim() === "") {
      continue;
    }

    html.push("<p>" + inlineFormat(line) + "</p>");
  }

  closeList();

  return html.join("");
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

// One layout state for the existing navigation and Tom panels.
const mobileLayout = window.matchMedia("(max-width: 900px)");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarClose = document.getElementById("sidebarClose");
const tomOpenToggle = document.getElementById("tomOpenToggle");
const panelBackdrop = document.getElementById("panelBackdrop");
const mainContent = document.querySelector(".app");
let desktopPanels = { sidebarCollapsed: false, tomCollapsed: false };
let mobileDrawer = null;
try {
  const saved = JSON.parse(sessionStorage.getItem("tomPanelLayout"));
  if (saved) desktopPanels = {
    sidebarCollapsed: saved.sidebarCollapsed === true,
    tomCollapsed: saved.tomCollapsed === true
  };
} catch (_) { /* Storage may be unavailable. */ }

navItems.forEach((item) => {
  const label = item.lastElementChild.textContent.trim();
  item.setAttribute("aria-label", label);
  item.title = label;
});

function applyPanelLayout() {
  const mobile = mobileLayout.matches;
  const navOpen = mobile ? mobileDrawer === "navigation" : !desktopPanels.sidebarCollapsed;
  collapsed = mobile ? mobileDrawer !== "tom" : desktopPanels.tomCollapsed;
  document.body.classList.toggle("sidebar-collapsed", !mobile && !navOpen);
  document.body.classList.toggle("tom-collapsed", collapsed);
  document.body.classList.toggle("nav-mobile-open", mobile && navOpen);
  document.body.classList.toggle("tom-mobile-open", mobile && !collapsed);
  document.body.classList.toggle("drawer-open", mobile && mobileDrawer !== null);
  sidebar.inert = mobile && !navOpen;
  panel.inert = collapsed;
  mainContent.inert = mobile && mobileDrawer !== null;
  sidebar.setAttribute("aria-hidden", String(mobile && !navOpen));
  panel.setAttribute("aria-hidden", String(collapsed));
  sidebarToggle.setAttribute("aria-expanded", String(navOpen));
  sidebarToggle.setAttribute("aria-label", navOpen ? "Collapse navigation" : "Open navigation");
  tomOpenToggle.setAttribute("aria-expanded", String(!collapsed));
  tomOpenToggle.inert = mobile && mobileDrawer !== null;
  toggleButton.setAttribute("aria-label", mobile ? "Close task intelligence" : "Collapse task intelligence");
  toggleButton.title = mobile ? "Close task intelligence" : "Collapse task intelligence";
  toggleButton.textContent = mobile ? "×" : "›";
  panelBackdrop.hidden = !mobile || mobileDrawer === null;
}

function savePanelLayout() {
  try { sessionStorage.setItem("tomPanelLayout", JSON.stringify(desktopPanels)); }
  catch (_) { /* Keep working without storage. */ }
}

function closeMobileDrawers() {
  const previous = mobileDrawer;
  mobileDrawer = null;
  applyPanelLayout();
  if (previous) (previous === "tom" ? tomOpenToggle : sidebarToggle).focus();
}

function togglePanel() {
  if (mobileLayout.matches) {
    if (mobileDrawer === "tom") return closeMobileDrawers();
    mobileDrawer = "tom";
  } else {
    desktopPanels.tomCollapsed = !desktopPanels.tomCollapsed;
    savePanelLayout();
  }
  applyPanelLayout();
  (collapsed ? tomOpenToggle : toggleButton).focus();
}

sidebarToggle.addEventListener("click", () => {
  if (mobileLayout.matches) {
    mobileDrawer = mobileDrawer === "navigation" ? null : "navigation";
  } else {
    desktopPanels.sidebarCollapsed = !desktopPanels.sidebarCollapsed;
    savePanelLayout();
  }
  applyPanelLayout();
  if (mobileDrawer === "navigation") sidebarClose.focus();
});
sidebarClose.addEventListener("click", closeMobileDrawers);
panelBackdrop.addEventListener("click", closeMobileDrawers);
toggleButton.addEventListener("click", togglePanel);
tomOpenToggle.addEventListener("click", togglePanel);
mobileLayout.addEventListener("change", () => {
  mobileDrawer = null;
  applyPanelLayout();
  if (document.activeElement.closest("[inert]")) sidebarToggle.focus();
});
document.addEventListener("keydown", (event) => {
  if (!mobileLayout.matches || !mobileDrawer) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMobileDrawers();
  } else if (event.key === "Tab") {
    const drawer = mobileDrawer === "tom" ? panel : sidebar;
    const controls = [...drawer.querySelectorAll("button:not(:disabled), input, textarea, [tabindex='0']")]
      .filter((el) => el.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
});
panel.setAttribute("role", "complementary");
panel.setAttribute("aria-label", "Task intelligence");
applyPanelLayout();

// History toggle
let historyVisible = false;
historyPanel.style.display = "none";
function toggleHistory() {
  historyVisible = !historyVisible;
  historyPanel.style.display = historyVisible ? "block" : "none";
  historyToggle.setAttribute("aria-expanded", historyVisible);
  historyPanel.setAttribute("aria-hidden", String(!historyVisible));
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

    const messageCount = conv.messages?.length || 0;
    const activity = formatLastActivity(conv);

    item.innerHTML = `
      <div class="conversation-title">${escapeHtml(conv.title || "Conversation")}</div>
      <div class="conversation-meta">
        <span class="conversation-preview">${messageCount > 0 ? `${messageCount} messages` : "No messages"}</span>
        <span class="conversation-time">${escapeHtml(activity)}</span>
      </div>
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

// Normalize stored roles to a display role:
// user | tom | system
function displayRole(role) {
  if (role === "user") return "user";
  if (role === "tool") return "tool";
  if (role === "system") return "system";
  return "tom";
}

function roleLabel(role) {
  if (role === "system") return "System";
  if (role === "tool") return "Tool activity";
  if (role === "user") return "You";
  return "Tom";
}

// Attach Copy behavior to every code block in a container.
function wireCodeCopy(container) {
  container.querySelectorAll(".code-copy").forEach((button) => {
    button.addEventListener("click", async () => {
      const block = button.closest(".code-block");
      const codeEl = block ? block.querySelector("code") : null;
      if (!codeEl) return;

      const text = codeEl.textContent;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement("textarea");
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          document.body.removeChild(area);
        }

        const original = button.textContent;
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove("copied");
        }, 1400);
      } catch (e) {
        button.textContent = "Copy failed";
      }
    });
  });
}

// Render messages with markdown support.
// Clearly distinguishes user, Tom, and system/tool activity.
function renderMessages(messages) {
  messagesContainer.innerHTML = "";

  if (messages.length === 0) {
    messagesContainer.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:20px;">Start a conversation by typing a message below.</div>';
    return;
  }

  messages.forEach((msg) => {
    const role = displayRole(msg.role);

    const msgDiv = document.createElement("div");
    msgDiv.className = `tom-message ${role}`;

    // Only live chat turns announce; system/tool notes stay quiet.
    if (role === "user" || role === "tom") {
      msgDiv.setAttribute("role", "alert");
    }

    const rendered = renderMarkdown(msg.content);

    const largeBadge = msg.largeFile
      ? '<span class="large-file-note">Large file — targeted analysis required</span>'
      : "";

    msgDiv.innerHTML = `
      <div class="message-role">${roleLabel(msg.role)}</div>
      <div class="message-content">
        ${largeBadge}
        ${rendered}
      </div>
    `;

    // Render any code Copy buttons created by renderMarkdown.
    wireCodeCopy(msgDiv);

    // Add small timestamp for Tom messages.
    if (role === "tom" && msg.timestamp) {
      const timeSpan = document.createElement("span");
      timeSpan.className = "message-time";
      timeSpan.textContent = msg.timestamp;
      msgDiv.querySelector(".message-content").appendChild(timeSpan);
    }

    messagesContainer.appendChild(msgDiv);
  });

  // Scroll to bottom.
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
    if (!mobileLayout.matches && document.body.classList.contains("command-page")) inputField.focus();
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
  conv.lastActivity = Date.now();
  saveConversations();

  // Re-render all messages in this conversation
  renderMessages(conv.messages);
  renderHistory();

  // Clear input and disable send while waiting
  inputField.value = "";
  sendButton.disabled = true;
  responseDisplay.textContent = "Tom is thinking...";

  // Build history to send: all messages before the one we just added.
  // Tool/system activity is display-only and never sent to the model.
  const historyForServer = conv.messages.slice(0, -1)
    .filter(m => m.role === "user" || m.role === "tom")
    .map(m => ({
      role: m.role === "tom" ? "assistant" : m.role,
      content: m.content,
      ...(m.approvalId ? { approvalId: m.approvalId } : {})
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

      // Compact tool activity (e.g. "Checking Git status...").
    // Displayed in the conversation, but excluded from model history.
    const activity = Array.isArray(data.toolActivity)
      ? data.toolActivity
      : [];

    if (activity.length > 0) {
      activity.forEach((label) => {
        conv.messages.push({
          role: "tool",
          content: label,
          timestamp: new Date().toISOString()
        });
      });
    }

    const tomReply = data.reply || "Tom returned no response.";

    // Append Tom response to the same conversation
    const tomMsg = {
      role: "tom",
      content: tomReply,
      timestamp: new Date().toISOString(),
      ...(data.approvalId ? { approvalId: data.approvalId } : {})
    };
    conv.messages.push(tomMsg);
    conv.lastActivity = Date.now();
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
    conv.lastActivity = Date.now();
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

// ---------------------------------------
// QUICK ACTIONS DROPDOWN
// ---------------------------------------
// One compact dropdown replacing the old suggested-prompt buttons.
// Reuses the existing chat composer (/chat) and file analysis
// (/analyze-file). No new AI endpoints or chat system.

const quickActionsToggle = document.getElementById("quickActionsToggle");
const quickActionsMenu = document.getElementById("quickActionsMenu");

function openQuickActions() {
  if (!quickActionsMenu) return;
  quickActionsMenu.hidden = false;
  if (quickActionsToggle) {
    quickActionsToggle.setAttribute("aria-expanded", "true");
  }
}

function closeQuickActions() {
  if (!quickActionsMenu) return;
  quickActionsMenu.hidden = true;
  if (quickActionsToggle) {
    quickActionsToggle.setAttribute("aria-expanded", "false");
  }
}

function toggleQuickActions() {
  if (!quickActionsMenu) return;
  if (quickActionsMenu.hidden) {
    openQuickActions();
  } else {
    closeQuickActions();
  }
}

// Send a normal chat prompt through the existing composer flow.
function runQuickChat(prompt) {
  if (!prompt) return;
  inputField.value = prompt;
  sendMessage();
}

// Show a clear message when a file action is used with no active file.
function showNoFileContext(actionLabel) {
  let conv = getActiveConversation();
  if (!conv) {
    conv = createConversation("Quick Actions");
  }

  conv.messages.push({
    role: "system",
    content:
      '"' + actionLabel + '" needs a current file. ' +
      "Open Workspace, select a file, or use " +
      '"Ask Tom about this file" first.',
    timestamp: new Date().toISOString()
  });
  conv.lastActivity = Date.now();
  saveConversations();
  renderMessages(conv.messages);
  renderHistory();
  updateInputState(true);
}

// Run a file action against the existing active file context
// using the existing /analyze-file endpoint.
async function runFileAction(question, actionLabel) {
  const file = activeFileContext || selectedWorkspaceFile;

  if (!file) {
    showNoFileContext(actionLabel);
    return;
  }

  setActiveFileContext(file);

  let conv = getActiveConversation();
  if (!conv) {
    conv = createConversation(actionLabel + " — " + file);
  }

  conv.messages.push({
    role: "user",
    content: actionLabel + ": " + file,
    timestamp: new Date().toISOString()
  });
  conv.lastActivity = Date.now();
  saveConversations();
  renderMessages(conv.messages);
  renderHistory();

  responseDisplay.textContent = "Tom is analyzing " + file + "…";

  try {
    const response = await fetch("/analyze-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: file,
        question: question
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Tom file analysis failed");
    }

    const tomMsg = {
      role: "tom",
      content: data.reply || "Tom returned no response.",
      timestamp: new Date().toISOString(),
      largeFile: data.largeFile === true
    };

    conv.messages.push(tomMsg);
    conv.lastActivity = Date.now();
    saveConversations();
    renderMessages(conv.messages);
    renderHistory();
  } catch (error) {
    conv.messages.push({
      role: "tom",
      content: "Tom file analysis error: " + error.message,
      timestamp: new Date().toISOString()
    });
    conv.lastActivity = Date.now();
    saveConversations();
    renderMessages(conv.messages);
    renderHistory();
  } finally {
    updateInputState(true);
  }
}

if (quickActionsToggle && quickActionsMenu) {
  quickActionsToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleQuickActions();
  });

  quickActionsMenu.addEventListener("click", (event) => {
    event.stopPropagation();

    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const prompt = button.dataset.prompt || "";
    const question = button.dataset.question || prompt;
    const label = button.textContent.trim();

    closeQuickActions();

    if (action === "file") {
      runFileAction(question, label);
    } else {
      runQuickChat(prompt);
    }
  });

  document.addEventListener("click", (event) => {
    if (quickActionsMenu.hidden) return;
    if (!event.target.closest("#tomActions")) {
      closeQuickActions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !quickActionsMenu.hidden) {
      closeQuickActions();
      quickActionsToggle.focus();
    }
  });
}

// Initialize
function initTomPanel() {
  // Render initial history
  renderHistory();

  // Set initial input state
  updateInputState(true);

  // Focus input after a short delay
  setTimeout(() => {
    if (!collapsed && !mobileLayout.matches && document.body.classList.contains("command-page")) inputField.focus();
  }, 100);
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTomPanel);
} else {
  initTomPanel();
}


// ---------------------------------------
// WORKSPACE PAGE
// ---------------------------------------
// Loads the authorized project from GET /project,
// renders a file explorer from the returned entries,
// and reads files through GET /file?path=.
// "Ask Tom about this file" reuses the existing
// Tom conversation UI and POST /analyze-file.

const workspaceExplorer = document.getElementById("workspaceExplorer");
const workspaceViewer = document.getElementById("workspaceViewer");
const workspaceProjectName = document.getElementById("workspaceProjectName");
const workspaceProjectPath = document.getElementById("workspaceProjectPath");
const workspaceFileCount = document.getElementById("workspaceFileCount");
const workspaceExplorerCount = document.getElementById("workspaceExplorerCount");
const workspaceFileName = document.getElementById("workspaceFileName");
const workspaceFilePath = document.getElementById("workspaceFilePath");
const workspaceAskTom = document.getElementById("workspaceAskTom");
const workspaceRefresh = document.getElementById("workspaceRefresh");
const workspaceStatus = document.getElementById("workspaceStatus");
const workspaceStatusDetail = document.getElementById("workspaceStatusDetail");

let workspaceLoaded = false;
let selectedWorkspaceFile = null;

function setWorkspaceStatus(label, detail, state) {
  if (workspaceStatus) {
    workspaceStatus.textContent = label;

    if (state === "error") {
      workspaceStatus.style.color = "var(--danger)";
    } else if (state === "loading") {
      workspaceStatus.style.color = "#3266a8";
    } else {
      workspaceStatus.style.color = "var(--success)";
    }
  }

  if (workspaceStatusDetail) {
    workspaceStatusDetail.textContent = detail;
  }
}

function showWorkspaceState(container, message, stateClass) {
  if (!container) return;

  container.innerHTML = "";

  const state = document.createElement("div");
  state.className = "workspace-state" + (stateClass ? " " + stateClass : "");
  state.textContent = message;

  container.appendChild(state);
}

// Render the explorer using ONLY entries returned by /project.
function renderWorkspaceExplorer(files) {
  if (!workspaceExplorer) return;

  workspaceExplorer.innerHTML = "";

  if (!files || files.length === 0) {
    showWorkspaceState(
      workspaceExplorer,
      "This project has no files to display.",
      ""
    );
    return;
  }

  files.forEach((entry) => {
    const isFolder = entry.type === "folder";

    // Folders are shown but not selectable, because /project
    // only returns top-level entries (no nested contents).
    const node = document.createElement(isFolder ? "div" : "button");

    node.className =
      "workspace-node " + (isFolder ? "folder" : "file");

    if (!isFolder) {
      node.type = "button";
    }

    const icon = document.createElement("span");
    icon.className = "workspace-node-icon";
    icon.textContent = isFolder ? "📁" : "📄";

    const name = document.createElement("span");
    name.className = "workspace-node-name";
    name.textContent = entry.name;

    node.appendChild(icon);
    node.appendChild(name);

    if (!isFolder) {
      node.addEventListener("click", () => {
        openWorkspaceFile(entry.name, node);
      });
    }

    workspaceExplorer.appendChild(node);
  });
}

// Read a file through the existing GET /file endpoint.
async function openWorkspaceFile(fileName, node) {
  selectedWorkspaceFile = fileName;

  if (workspaceExplorer) {
    workspaceExplorer
      .querySelectorAll(".workspace-node")
      .forEach((n) => n.classList.remove("selected"));
  }

  if (node) {
    node.classList.add("selected");
  }

  if (workspaceFileName) {
    workspaceFileName.textContent = fileName;
  }

  if (workspaceFilePath) {
    workspaceFilePath.textContent = fileName;
  }

  if (workspaceAskTom) {
    workspaceAskTom.disabled = true;
  }

  showWorkspaceState(workspaceViewer, "Loading file…", "loading");

  try {
    const response = await fetch(
      "/file?path=" + encodeURIComponent(fileName)
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to read file");
    }

    // Preserve whitespace exactly using a <pre> element.
    workspaceViewer.innerHTML = "";

    const pre = document.createElement("pre");
    pre.className = "workspace-code";
    pre.textContent = data.content != null ? data.content : "";

    workspaceViewer.appendChild(pre);

    if (workspaceAskTom) {
      workspaceAskTom.disabled = false;
    }

  } catch (error) {
    showWorkspaceState(
      workspaceViewer,
      "Could not read file: " + error.message,
      "error"
    );

    if (workspaceAskTom) {
      workspaceAskTom.disabled = true;
    }
  }
}

// Load the authorized project from GET /project.
async function loadWorkspace() {
  workspaceLoaded = true;

  setWorkspaceStatus("Loading", "Reading project…", "loading");

  showWorkspaceState(
    workspaceExplorer,
    "Loading project files…",
    "loading"
  );

  if (workspaceFileCount) {
    workspaceFileCount.textContent = "—";
  }

  if (workspaceExplorerCount) {
    workspaceExplorerCount.textContent = "";
  }

  try {
    const response = await fetch("/project");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load project");
    }

    const files = Array.isArray(data.files) ? data.files : [];

    if (workspaceProjectName) {
      workspaceProjectName.textContent =
        data.project || "Project Workspace";
    }

    if (workspaceProjectPath) {
      workspaceProjectPath.textContent =
        data.root || "Unknown project root";
    }

    const fileCount = files.filter(
      (entry) => entry.type === "file"
    ).length;

    if (workspaceFileCount) {
      workspaceFileCount.textContent = String(fileCount);
    }

    if (workspaceExplorerCount) {
      workspaceExplorerCount.textContent =
        files.length + " entries";
    }

    renderWorkspaceExplorer(files);

    setWorkspaceStatus("Ready", "Project loaded", "ok");

  } catch (error) {
    showWorkspaceState(
      workspaceExplorer,
      "Could not load project: " + error.message,
      "error"
    );

    setWorkspaceStatus("Error", "Project unavailable", "error");
  }
}

// Reuse the existing Tom conversation UI + POST /analyze-file.
async function askTomAboutFile() {
  if (!selectedWorkspaceFile) return;

  // Show the active file as a removable context chip.
  setActiveFileContext(selectedWorkspaceFile);

  const question =
    "Explain what this file does, its key responsibilities, " +
    "and anything important to know about it.";

  let conv = getActiveConversation();

  if (!conv) {
    conv = createConversation(
      "Analyze " + selectedWorkspaceFile
    );
  }

  const userMsg = {
    role: "user",
    content:
      "Ask Tom about this file: " + selectedWorkspaceFile,
    timestamp: new Date().toISOString()
  };

  conv.messages.push(userMsg);
  conv.lastActivity = Date.now();
  saveConversations();
  renderMessages(conv.messages);
  renderHistory();

  responseDisplay.textContent =
    "Tom is analyzing " + selectedWorkspaceFile + "…";

  try {
    const response = await fetch("/analyze-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: selectedWorkspaceFile,
        question: question
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Tom file analysis failed"
      );
    }

    // Oversized files are never sent to the model in full.
    // The server returns a clear "large file" result instead.
    const tomMsg = {
      role: "tom",
      content: data.reply || "Tom returned no response.",
      timestamp: new Date().toISOString(),
      largeFile: data.largeFile === true
    };

    conv.messages.push(tomMsg);
    conv.lastActivity = Date.now();
    saveConversations();
    renderMessages(conv.messages);
    renderHistory();

  } catch (error) {
    const errorMsg = {
      role: "tom",
      content:
        "Tom file analysis error: " + error.message,
      timestamp: new Date().toISOString()
    };

    conv.messages.push(errorMsg);
    conv.lastActivity = Date.now();
    saveConversations();
    renderMessages(conv.messages);
    renderHistory();

  } finally {
    updateInputState(true);
  }
}

// ---------------------------------------
// ACTIVE CONTEXT (removable chip)
// ---------------------------------------
// Shows the active file above the composer, e.g. "fibonacci.py ×".
// Removing the chip clears the active file context.
// The file contents are never pasted into the visible composer.

const tomContextChips = document.getElementById("tomContextChips");
const tomContext = document.getElementById("tomContext");
let activeFileContext = null;

function renderContextChips() {
  if (!tomContextChips) return;

  tomContextChips.innerHTML = "";

  if (!activeFileContext) {
    tomContextChips.hidden = true;
    if (tomContext) tomContext.textContent = "Project: Drop";
    return;
  }

  tomContextChips.hidden = false;

  const chip = document.createElement("span");
  chip.className = "context-chip";

  const label = document.createElement("span");
  label.className = "context-chip-label";
  label.textContent = activeFileContext;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "context-chip-remove";
  remove.setAttribute("aria-label", "Remove file context");
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    activeFileContext = null;
    renderContextChips();
  });

  chip.appendChild(label);
  chip.appendChild(remove);
  tomContextChips.appendChild(chip);

  if (tomContext) {
    tomContext.textContent = "File: " + activeFileContext;
  }
}

function setActiveFileContext(fileName) {
  activeFileContext = fileName;
  renderContextChips();
}

// ---------------------------------------
// DESKTOP PANEL RESIZE (draggable divider)
// ---------------------------------------

const tomDivider = document.getElementById("tomDivider");
const TOM_MIN_WIDTH = 280;
const TOM_MAX_WIDTH = 720;
let tomWidth = 300;

try {
  const savedWidth = Number(sessionStorage.getItem("tomPanelWidth"));
  if (savedWidth >= TOM_MIN_WIDTH && savedWidth <= TOM_MAX_WIDTH) {
    tomWidth = savedWidth;
  }
} catch (_) { /* Storage may be unavailable. */ }

function applyTomWidth() {
  document.documentElement.style.setProperty("--tom-width", tomWidth + "px");
}

function saveTomWidth() {
  try { sessionStorage.setItem("tomPanelWidth", String(tomWidth)); }
  catch (_) { /* Keep working without storage. */ }
}

applyTomWidth();

if (tomDivider) {
  let dragging = false;

  const onMove = (event) => {
    if (!dragging) return;
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const next = window.innerWidth - clientX;
    tomWidth = Math.min(TOM_MAX_WIDTH, Math.max(TOM_MIN_WIDTH, next));
    applyTomWidth();
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("tom-resizing");
    saveTomWidth();
  };

  const startDrag = (event) => {
    if (mobileLayout.matches) return;
    dragging = true;
    document.body.classList.add("tom-resizing");
    event.preventDefault();
  };

  tomDivider.addEventListener("mousedown", startDrag);
  tomDivider.addEventListener("touchstart", startDrag, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", stopDrag);
  window.addEventListener("touchend", stopDrag);

  // Keyboard resize for accessibility.
  tomDivider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      tomWidth = Math.min(TOM_MAX_WIDTH, tomWidth + 20);
    } else if (event.key === "ArrowRight") {
      tomWidth = Math.max(TOM_MIN_WIDTH, tomWidth - 20);
    } else {
      return;
    }
    event.preventDefault();
    applyTomWidth();
    saveTomWidth();
  });
}

// Wire up Workspace controls.
if (workspaceRefresh) {
  workspaceRefresh.addEventListener("click", loadWorkspace);
}

if (workspaceAskTom) {
  workspaceAskTom.addEventListener("click", askTomAboutFile);
}

// If the Workspace page is already active on load, populate it.
if (
  document.getElementById("workspace") &&
  document.getElementById("workspace").classList.contains("active")
) {
  loadWorkspace();
}


// ---------------------------------------
// PLUGIN MARKETPLACE
// ---------------------------------------

const marketplacePage = document.getElementById("marketplace");
let marketplaceAllPlugins = [];
let marketplaceFiltered = [];

const marketplaceSearchInput = document.getElementById("marketplaceSearch");
const marketplaceCategorySelect = document.getElementById("marketplaceCategory");
const marketplaceGrid = document.getElementById("marketplaceGrid");
const installedGrid = document.getElementById("installedGrid");
const installedSummary = document.getElementById("installedSummary");
const topologyCanvas = document.getElementById("topologyCanvas");

const PROJECT_ID = "drop";

// Billing mode display labels
const BILLING_LABELS = {
  included: "Included",
  tom_metered: "Tom Metered",
  vendor_billed: "Vendor Billed",
  enterprise_license: "Enterprise License",
  bring_your_own_account: "BYO Account"
};

async function loadMarketplace() {
  if (!marketplaceGrid) return;

  marketplaceGrid.innerHTML = '<div class="marketplace-loading">Loading catalog...</div>';

  try {
    const response = await fetch("/plugins");
    if (!response.ok) throw new Error("Failed to load catalog");

    marketplaceAllPlugins = await response.json();

    // Load categories
    const catResponse = await fetch("/plugins/categories");
    const categories = catResponse.ok ? await catResponse.json() : [];

    // Populate category dropdown
    if (marketplaceCategorySelect) {
      categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        marketplaceCategorySelect.appendChild(opt);
      });
    }

    // Load install state for current project
    try {
      const installResp = await fetch(`/projects/${PROJECT_ID}/plugins`);
      if (installResp.ok) {
        const installData = await installResp.json();
        const installMap = {};
        installData.forEach(p => { installMap[p.id] = p; });
        marketplaceAllPlugins = marketplaceAllPlugins.map(p => {
          if (installMap[p.id]) {
            return { ...p, installed: true, enabled: installMap[p.id].enabled, status: installMap[p.id].status };
          }
          return { ...p, installed: false, enabled: false, status: "available" };
        });

        const installedPlugins = marketplaceAllPlugins.filter(plugin => plugin.installed);
        const statusResults = await Promise.all(installedPlugins.map(async plugin => {
          const statusResponse = await fetch(`/projects/${PROJECT_ID}/plugins/${plugin.id}/status`);
          return statusResponse.ok ? statusResponse.json() : null;
        }));
        statusResults.filter(Boolean).forEach(status => {
          const plugin = marketplaceAllPlugins.find(item => item.id === status.id);
          if (plugin) Object.assign(plugin, {
            installed: status.installed,
            enabled: status.enabled,
            status: status.status
          });
        });
      }
    } catch (e) { /* Ignore */ }

    marketplaceFiltered = [...marketplaceAllPlugins];
    renderMarketplacePlugins();
    refreshProjectPluginViews();
  } catch (error) {
    marketplaceGrid.innerHTML = `<div class="marketplace-error">Failed to load catalog: ${error.message}</div>`;
  }
}

function renderMarketplacePlugins() {
  if (!marketplaceGrid) return;

  if (marketplaceFiltered.length === 0) {
    marketplaceGrid.innerHTML = '<div class="marketplace-empty">No plugins found matching your search.</div>';
    return;
  }

  marketplaceGrid.innerHTML = "";
  marketplaceFiltered.forEach(plugin => {
    const card = createPluginCard(plugin);
    marketplaceGrid.appendChild(card);
  });
}

// Brand assets are centralized so manifests remain metadata-only.
const MARKETPLACE_BRAND_ASSETS = {
  vscode: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/visualstudiocode.svg",
  visualstudio: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/visualstudio.svg",
  intellij: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/intellijidea.svg",
  pycharm: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/pycharm.svg",
  webstorm: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/webstorm.svg",
  git: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/git.svg",
  github: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/github.svg",
  gitlab: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/gitlab.svg",
  bitbucket: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/bitbucket.svg",
  jira: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/jira.svg",
  aws: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/amazonaws.svg",
  azure: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoftazure.svg",
  databricks: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/databricks.svg",
  postgresql: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/postgresql.svg",
  docker: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg",
  kubernetes: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/kubernetes.svg",
  slack: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/slack.svg"
};

function renderPluginIcon(container, plugin, size = "compact") {
  container.replaceChildren();
  container.classList.add(`plugin-icon-${size}`);

  const assetUrl = MARKETPLACE_BRAND_ASSETS[plugin.id];
  if (assetUrl) {
    const image = document.createElement("img");
    image.src = assetUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.replaceWith(createFallbackIcon());
    }, { once: true });
    container.appendChild(image);
    return;
  }

  container.appendChild(createFallbackIcon());
}

function createFallbackIcon() {
  const fallback = document.createElement("span");
  fallback.className = "tom-icon-fallback";
  fallback.textContent = "T";
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
}

function createPluginCard(plugin) {
  const card = document.createElement("div");
  card.className = "marketplace-card compact";
  card.dataset.pluginId = plugin.id;

  // Compact view: only icon and name, with optional installed indicator
  let installedIndicator = "";
  if (plugin.installed) {
    installedIndicator = `<span class="installed-indicator" title="Installed">&#10003;</span>`;
  }

  const content = document.createElement("div");
  content.className = "marketplace-card-content";

  const icon = document.createElement("span");
  icon.className = "marketplace-icon";
  renderPluginIcon(icon, plugin);
  content.appendChild(icon);

  const name = document.createElement("span");
  name.className = "marketplace-name";
  const nameText = document.createElement("strong");
  nameText.textContent = plugin.name;
  name.appendChild(nameText);
  if (installedIndicator) {
    const indicator = document.createElement("span");
    indicator.className = "installed-indicator";
    indicator.title = "Installed";
    indicator.textContent = "✓";
    name.appendChild(indicator);
  }
  content.appendChild(name);
  card.appendChild(content);

  // Entire card is clickable to open detail view
  card.addEventListener("click", () => showPluginDetail(plugin));

  return card;
}

function getStatusClass(status) {
  switch (status) {
    case "connected": return "healthy";
    case "available": return "neutral";
    case "installed": return "healthy";
    case "configuration_required": return "warning";
    case "disconnected": return "warning";
    case "degraded": return "warning";
    case "disabled": return "neutral";
    case "error": return "error";
    default: return "neutral";
  }
}

function getStatusLabel(status) {
  return {
    available: "Available",
    installed: "Installed",
    configuration_required: "Setup required",
    connected: "Connected",
    degraded: "Degraded",
    disconnected: "Disconnected",
    disabled: "Disabled",
    error: "Error"
  }[status] || status || "Unknown";
}

function getInstalledPlugins() {
  return marketplaceAllPlugins.filter(plugin => plugin.installed === true);
}

function createStatusBadge(plugin) {
  const status = document.createElement("span");
  status.className = `plugin-status-badge ${getStatusClass(plugin.status)}`;
  status.textContent = getStatusLabel(plugin.status);
  return status;
}

function createInstalledCard(plugin) {
  const card = document.createElement("article");
  card.className = "installed-card";
  card.dataset.pluginId = plugin.id;
  card.tabIndex = 0;

  const header = document.createElement("div");
  header.className = "installed-card-header";
  const icon = document.createElement("span");
  icon.className = "marketplace-icon";
  renderPluginIcon(icon, plugin);
  header.appendChild(icon);

  const copy = document.createElement("div");
  copy.className = "installed-card-copy";
  const name = document.createElement("strong");
  name.textContent = plugin.name;
  const vendor = document.createElement("span");
  vendor.textContent = plugin.vendor || "Unknown vendor";
  copy.append(name, vendor);
  header.appendChild(copy);
  header.appendChild(createStatusBadge(plugin));
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "installed-card-meta";
  meta.textContent = `${plugin.category || "Uncategorized"} · ${plugin.connectionType || "integration"}`;
  card.appendChild(meta);

  const openDetail = () => showPluginDetail(plugin);
  card.addEventListener("click", openDetail);
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  });
  return card;
}

function renderInstalledView() {
  if (!installedGrid) return;
  const installed = getInstalledPlugins();
  installedGrid.replaceChildren();
  if (installedSummary) {
    installedSummary.textContent = `${installed.length} installed integration${installed.length === 1 ? "" : "s"}`;
  }
  if (installed.length === 0) {
    installedGrid.innerHTML = '<div class="marketplace-empty">No plugins are installed for this project.</div>';
    return;
  }
  installed.forEach(plugin => installedGrid.appendChild(createInstalledCard(plugin)));
}

function renderTopologyView() {
  window.TomTopology?.refresh();
}

function refreshProjectPluginViews() {
  renderInstalledView();
  renderTopologyView();
}

function handleMarketplaceSearch() {
  const query = marketplaceSearchInput?.value || "";
  const category = marketplaceCategorySelect?.value || "all";

  if (query.trim() === "") {
    marketplaceFiltered = [...marketplaceAllPlugins];
  } else {
    const lowerQuery = query.toLowerCase();
    marketplaceFiltered = marketplaceAllPlugins.filter(p => {
      const text = [p.name, p.description, p.vendor, p.category, ...(p.capabilities || []).map(c => c.name)]
        .join(" ").toLowerCase();
      return text.includes(lowerQuery);
    });
  }

  if (category !== "all") {
    marketplaceFiltered = marketplaceFiltered.filter(p => p.category === category);
  }

  renderMarketplacePlugins();
}

async function handlePluginAction(plugin, action) {
  const card = document.querySelector(`.marketplace-card[data-plugin-id="${plugin.id}"]`);
  const btn = document.getElementById("detailActionButton");

  const setLoading = (text) => {
    if (btn) { btn.disabled = true; btn.textContent = text; }
  };

  try {
    if (action === "install") {
      setLoading("Installing...");
      const resp = await fetch(`/projects/${PROJECT_ID}/plugins/${plugin.id}/install`, { method: "POST" });
      if (resp.ok) {
        const state = await resp.json();
        Object.assign(plugin, state);
        refreshPluginState(plugin, card);
        renderPluginDetail(plugin);
        refreshProjectPluginViews();
      } else {
        setLoading("Failed");
      }
    } else if (action === "enable") {
      setLoading("Enabling...");
      const resp = await fetch(`/projects/${PROJECT_ID}/plugins/${plugin.id}/enable`, { method: "POST" });
      if (resp.ok) {
        const state = await resp.json();
        Object.assign(plugin, state);
        refreshPluginState(plugin, card);
        renderPluginDetail(plugin);
        refreshProjectPluginViews();
      } else {
        setLoading("Failed");
      }
    } else if (action === "disable") {
      setLoading("Disabling...");
      const resp = await fetch(`/projects/${PROJECT_ID}/plugins/${plugin.id}/disable`, { method: "POST" });
      if (resp.ok) {
        const state = await resp.json();
        Object.assign(plugin, state);
        refreshPluginState(plugin, card);
        renderPluginDetail(plugin);
        refreshProjectPluginViews();
      } else {
        setLoading("Failed");
      }
    }
  } catch (error) {
    setLoading("Failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function refreshPluginState(plugin, card) {
  const dot = card?.querySelector(".status-dot");
  if (dot) {
    dot.className = `status-dot ${getStatusClass(plugin.status)}`;
    dot.title = plugin.status;
  }
}

// Wire up marketplace event listeners
if (marketplaceSearchInput) {
  marketplaceSearchInput.addEventListener("input", handleMarketplaceSearch);
}
if (marketplaceCategorySelect) {
  marketplaceCategorySelect.addEventListener("change", handleMarketplaceSearch);
}

// Auto-load marketplace if already active
if (marketplacePage && marketplacePage.classList.contains("active")) {
  loadMarketplace();
}

// Shared plugin detail template state
let currentPluginDetail = null;
let marketplaceHistoryPushed = false;
let detailReturnPage = "marketplace";
let marketplaceSearchText = "";
let marketplaceSelectedCategory = "all";
let marketplaceScrollTop = 0;

const DETAIL_STATUS_LABELS = {
  available: "Available",
  installed: "Installed",
  configuration_required: "Setup required",
  connected: "Connected",
  degraded: "Degraded",
  disconnected: "Disconnected",
  disabled: "Disabled",
  error: "Error"
};

function saveMarketplaceState() {
  marketplaceSearchText = marketplaceSearchInput?.value || "";
  marketplaceSelectedCategory = marketplaceCategorySelect?.value || "all";
  marketplaceScrollTop = marketplaceGrid?.scrollTop || 0;
}

function restoreMarketplaceState() {
  if (marketplaceSearchInput) marketplaceSearchInput.value = marketplaceSearchText;
  if (marketplaceCategorySelect) marketplaceCategorySelect.value = marketplaceSelectedCategory;
}

function setDetailText(id, value, fallback = "Not provided") {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}

function renderDetailList(container, items, formatter) {
  container.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement("span");
    empty.className = "detail-empty";
    empty.textContent = "Not provided by this manifest";
    container.appendChild(empty);
    return;
  }
  items.forEach(item => container.appendChild(formatter(item)));
}

function createDetailTag(label, description = "") {
  const item = document.createElement("div");
  item.className = "detail-item";
  const title = document.createElement("strong");
  title.textContent = label;
  item.appendChild(title);
  if (description) {
    const body = document.createElement("span");
    body.textContent = description;
    item.appendChild(body);
  }
  return item;
}

function renderPluginDetail(plugin) {
  const detailStatus = plugin.status || (plugin.installed ? "installed" : "available");
  const statusElement = document.getElementById("detailStatus");
  const statusGroup = document.getElementById("detailStatusGroup");
  const actionButton = document.getElementById("detailActionButton");

  renderPluginIcon(document.getElementById("detailIcon"), plugin, "detail");
  setDetailText("detailPluginName", plugin.name, "Plugin detail");
  setDetailText("detailFullName", plugin.name);
  setDetailText("detailVendor", plugin.vendor);
  setDetailText("detailCategory", plugin.category);
  setDetailText("detailDescription", plugin.description);
  setDetailText("detailBilling", BILLING_LABELS[plugin.billingMode] || plugin.billingMode);
  setDetailText("detailStatus", DETAIL_STATUS_LABELS[detailStatus] || detailStatus);
  statusElement.className = `detail-status-label status-${getStatusClass(detailStatus)}`;
  statusGroup.dataset.status = detailStatus;

  renderDetailList(
    document.getElementById("detailCapabilities"),
    plugin.capabilities,
    capability => createDetailTag(capability.name, capability.description)
  );
  renderDetailList(
    document.getElementById("detailAuth"),
    plugin.supportedAuth,
    auth => createDetailTag(auth)
  );
  renderDetailList(
    document.getElementById("detailRisk"),
    plugin.riskLevels,
    risk => createDetailTag(risk, "Manifest permission level")
  );

  const metadata = document.getElementById("detailMetadata");
  metadata.replaceChildren();
  [
    ["Connection", plugin.connectionType],
    ["Availability", plugin.availability],
    ["Installable", plugin.installable === true ? "Yes" : "No"]
  ].forEach(([label, value]) => metadata.appendChild(createDetailTag(label, value)));

  actionButton.disabled = detailStatus === "connected";
  actionButton.textContent = detailStatus === "connected"
    ? "Connected"
    : (!plugin.installed ? "Install" : (detailStatus === "configuration_required" ? "Configure" : (plugin.enabled ? "Disable" : "Enable")));
  actionButton.onclick = () => {
    if (!actionButton.disabled) {
      handlePluginAction(plugin, !plugin.installed ? "install" : (plugin.enabled ? "disable" : "enable"));
    }
  };
}

function showPluginDetail(plugin) {
  currentPluginDetail = plugin;
  const activePage = document.querySelector(".page.active");
  detailReturnPage = activePage && activePage.id !== "marketplaceDetail"
    ? activePage.id
    : "marketplace";
  saveMarketplaceState();
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  const detailPage = document.getElementById("marketplaceDetail");
  detailPage.removeAttribute("hidden");
  detailPage.classList.add("active");
  const backLabel = document.querySelector("#detailBackButton span:last-child");
  if (backLabel) {
    backLabel.textContent = detailReturnPage === "topology"
      ? "Back to Workspace Topology"
      : detailReturnPage === "installed"
        ? "Back to Installed"
        : "Back to Marketplace";
  }
  renderPluginDetail(plugin);

  if (!marketplaceHistoryPushed) {
    history.pushState({ marketplaceDetail: plugin.id }, "", `#plugin/${encodeURIComponent(plugin.id)}`);
    marketplaceHistoryPushed = true;
  }
}

function hidePluginDetail(fromHistory = false) {
  const detailPage = document.getElementById("marketplaceDetail");
  detailPage.classList.remove("active");
  detailPage.setAttribute("hidden", "");
  const returnPage = document.getElementById(detailReturnPage) || marketplacePage;
  returnPage.classList.add("active");
  currentPluginDetail = null;
  if (detailReturnPage === "marketplace") {
    restoreMarketplaceState();
    handleMarketplaceSearch();
    requestAnimationFrame(() => {
      if (marketplaceGrid) marketplaceGrid.scrollTop = marketplaceScrollTop;
    });
  } else {
    refreshProjectPluginViews();
  }

  if (!fromHistory && marketplaceHistoryPushed) {
    marketplaceHistoryPushed = false;
    history.back();
  } else {
    marketplaceHistoryPushed = false;
  }
}

const detailBackButton = document.getElementById("detailBackButton");
if (detailBackButton) detailBackButton.addEventListener("click", () => hidePluginDetail());
window.addEventListener("popstate", event => {
  if (marketplaceHistoryPushed && !event.state?.marketplaceDetail) hidePluginDetail(true);
});

window.TomTopology.init({
  projectId: PROJECT_ID,
  renderIcon: renderPluginIcon,
  viewDetails: node => {
    const plugin = marketplaceAllPlugins.find(item => item.id === node.pluginId);
    showPluginDetail(plugin || { ...node, id: node.pluginId, name: node.label, status: node.rawStatus });
  }
});
