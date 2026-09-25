const MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "deepseek-ai/deepseek-v4-flash-0731",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "poolside/laguna-xs-2.1",
  "nvidia/nemotron-3-super-120b-a12b",
  "openai/gpt-oss-20b"
];

async function askNvidia(messages, options = {}) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set");

  for (const model of MODELS) {
    try {
      const response = await fetch(
        // TOM_MODEL_BASE_URL lets a black-box acceptance run point the REAL
        // server at a local model stub. Unset in production.
        (typeof process !== "undefined" && process.env && process.env.TOM_MODEL_BASE_URL
          ? String(process.env.TOM_MODEL_BASE_URL).trim()
          : "https://integrate.api.nvidia.com/v1/chat/completions"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          // Pause/Stop aborts the in-flight model call at the safe boundary.
          signal: options.signal || undefined,
          // Ask reasoning-capable models (e.g. nemotron) to skip emitting a
          // visible thinking trace. Unsupported models ignore this field.
          body: JSON.stringify({
            model,
            messages,
            max_tokens: Number.isInteger(options.maxTokens) ? options.maxTokens : 1000,
            chat_template_kwargs: { thinking: false },
            ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {})
          })
        }
      );

      if (!response.ok) {
        console.log(`⚠️ ${model}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      return {
        model,
        content: data.choices?.[0]?.message?.content
      };

    } catch (error) {
      // An aborted call is a deliberate task-control action (Pause/Stop):
      // never fall through to the next model — propagate immediately.
      if (options.signal && options.signal.aborted) throw error;
      console.log(`⚠️ ${model}: ${error.message}`);
    }
  }

  throw new Error("All NVIDIA models failed");
}

module.exports = { askNvidia, MODELS };