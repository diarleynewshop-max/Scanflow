import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_mvardqmhhvljrkfmiuqg",
  runtime: "node",
  dirs: ["./src/trigger"],
  maxDuration: 5,
  build: {
    external: ["sharp", "@anthropic-ai/claude-agent-sdk"],
  },
});
