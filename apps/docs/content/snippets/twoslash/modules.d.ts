// Platform modules a web app cannot install.
declare module "~/lib/auth" {
  export const auth: import("@auth-ts/core").Auth
}
declare module "@/lib/auth" {
  export const auth: import("@auth-ts/core").Auth
}
declare module "expo-secure-store" {
  export function getItemAsync(key: string): Promise<string | null>
  export function setItemAsync(key: string, value: string): Promise<void>
  export function deleteItemAsync(key: string): Promise<void>
}
declare module "@solidjs/start/server" {
  export interface APIEvent {
    request: Request
  }
}
declare module "cloudflare:workers" {
  export function waitUntil(promise: Promise<unknown>): void
}
