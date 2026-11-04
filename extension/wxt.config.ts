import { defineConfig } from "wxt";

// Set at build time: WXT_API_URL=https://wordbook.example.com pnpm build
const API_URL = (process.env.WXT_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const api = new URL(API_URL);

export default defineConfig({
  manifest: {
    name: "English Wordbook",
    description: "Save English words with the page and sentence where you found them.",
    permissions: ["contextMenus", "storage", "activeTab", "scripting", "alarms"],
    // Match patterns have no port, so this covers e.g. localhost:3000 too.
    // Listing the server here lets the extension call it without CORS.
    host_permissions: [`${api.protocol}//${api.hostname}/*`],
    action: { default_title: "English Wordbook" },
  },
  vite: () => ({ define: { __API_URL__: JSON.stringify(API_URL) } }),
});
