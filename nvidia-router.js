const MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "deepseek-ai/deepseek-v4-flash-0731",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "poolside/laguna-xs-2.1",
  "nvidia/nemotron-3-super-120b-a12b",
  "openai/gpt-oss-20b"
];

async function askNvidia(messages) {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set");

  for (const model of MODELS) {
    try {
      const response = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: 1000
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
      console.log(`⚠️ ${model}: ${error.message}`);
    }
  }

  throw new Error("All NVIDIA models failed");
}

module.exports = { askNvidia };