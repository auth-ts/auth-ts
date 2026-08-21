import type { HeadersInput } from "../session/resolve-session.ts"
/** One linked provider, as shown on an account screen. */
export interface ConnectionInfo {
  provider: string
  /** The address the provider reported. Metadata only — never the match key. */
  email?: string | null
}
/** Lists the signed-in user's linked providers. */
export declare const listConnections: import("../http/define-endpoint.ts").EndpointDefinition<
  HeadersInput,
  {
    connections: ConnectionInfo[]
  }
>
//# sourceMappingURL=connections.d.ts.map
