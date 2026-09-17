const { askNvidia } = require("./nvidia-router");

async function test() {
  const result = await askNvidia([
    {
      role: "user",
      content: "Reply exactly: TOM ROUTER WORKING"
    }
  ]);

  console.log("Model:", result.model);
  console.log("Response:", result.content);
}

test().catch(console.error);