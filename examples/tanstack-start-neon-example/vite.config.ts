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
  // Vite answers CORS preflights itself, permissively for any localhost origin
  // and without Allow-Credentials, which shadows the auth handler and makes dev
  // disagree with production. Off in both servers, so `authServer.handler`
  // answers OPTIONS everywhere.
  server: { port: 3000, cors: false },
  preview: { cors: false }
})
