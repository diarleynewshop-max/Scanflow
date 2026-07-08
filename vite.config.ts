import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const DEFAULT_SUPABASE_URL = "https://sknyigbnlbbpbbmsbbmc.supabase.co";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        name: "Scan Newshop",
        short_name: "Newshop",
        description: "Scanner, conferencia e compras (Newshop / Soye / Facil)",
        lang: "pt-BR",
        theme_color: "#4f46e5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,jpeg,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "/index.html",
        // Nao intercepta as funcoes serverless da Vercel.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Fotos do Supabase Storage: CacheFirst (cada foto tem path fixo).
            urlPattern: ({ url }) => url.href.includes("/storage/v1/object/public/"),
            handler: "CacheFirst",
            options: {
              cacheName: "supabase-fotos",
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Fallback pra quando a Vercel so tem SUPABASE_URL/SUPABASE_ANON_KEY (sem o
    // prefixo VITE_, ex.: integracao nativa Vercel<->Supabase que nao deixa
    // renomear). So injeta URL + anon key — NUNCA a service_role.
    __SUPABASE_URL_FALLBACK__: JSON.stringify(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL),
    __SUPABASE_FUNCTIONS_URL_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_FUNCTIONS_URL ||
      process.env.SUPABASE_FUNCTIONS_URL ||
      DEFAULT_SUPABASE_URL
    ),
    __SUPABASE_ANON_KEY_FALLBACK__: JSON.stringify(process.env.SUPABASE_ANON_KEY || ""),
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      // Trigger.dev é server-side — não entra no bundle do frontend
      external: [
        "@trigger.dev/sdk",
        "@trigger.dev/sdk/v3",
        "@trigger.dev/build",
      ],
    },
  },
});
