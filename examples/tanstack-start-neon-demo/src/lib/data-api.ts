import { authClient } from "../auth-client.ts"

const DATA_API_URL = import.meta.env.VITE_NEON_DATA_API_URL ?? ""

/**
 * Calls the Neon Data API with the current access token.
 *
 * This is the entire data plane: about thirty lines of `fetch`, with no client
 * library in between, so the thing being demonstrated — our JWT producing
 * row-scoped results — is visible in one place.
 *
 * On a 401 it drops the cached token, fetches a new one, and retries **once**.
 * Never a loop: if the second attempt is also refused, the session is genuinely
 * gone and retrying forever would just hammer the endpoint.
 */
export async function dataApi<Result>(
  path: string,
  init: RequestInit & { body?: string } = {}
): Promise<Result> {
  const send = async () => {
    const accessToken = await authClient.getToken()

    return fetch(`${DATA_API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        prefer: "return=representation"
      }
    })
  }

  let response = await send()

  if (response.status === 401) {
    authClient.clearToken()
    response = await send()
  }

  if (!response.ok) {
    throw new Error(
      `Data API request failed: ${response.status} ${await response.text()}`
    )
  }

  return response.status === 204
    ? (undefined as Result)
    : ((await response.json()) as Result)
}
