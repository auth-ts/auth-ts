import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    react()
  ],
  server: {
    port: 3000,
    // Vite answers the preflight itself and omits Allow-Credentials, so a
    // cross-origin request carrying a cookie fails before reaching the auth
    // handler. Off, so `authServer.handler` answers OPTIONS as it is written to.
    cors: false
  }
})
