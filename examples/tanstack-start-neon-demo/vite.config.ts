import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // The Cloudflare plugin runs the SSR environment inside workerd, so `vite dev`
  // exercises the same runtime the deploy targets. It also loads `.env` into the
  // Worker's environment, which is why no script here passes `--env-file`.
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    react()
  ],
  // AUTH_BASE_URL builds every OAuth redirect_uri, and the provider matches it
  // against what is registered — so the dev port is part of the configuration,
  // not a detail. strictPort makes a busy 3000 fail here instead of quietly
  // serving 3001, where sign-in would break with a provider-side error.
  server: { port: 3000, strictPort: true }
})
