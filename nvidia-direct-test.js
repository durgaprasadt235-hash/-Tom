const API_KEY = process.env.NVIDIA_API_KEY;

const models = [
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "deepseek-ai/deepseek-v4-flash-0731",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "poolside/laguna-xs-2.1",
  "openai/gpt-oss-20b"
];

async function test(model) {
  try {
    const res = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply OK" }],
          max_tokens: 10
        })
      }
    );

    console.log(`${res.ok ? "✅" : "❌"} ${model} — HTTP ${res.status}`);
  } catch (e) {
    console.log(`❌ ${model} — ${e.message}`);
  }
}

async function main() {
  // Sequential = avoids hammering NVIDIA/free rate limits.
  for (const model of models) {
    await test(model);
  }
}

main();