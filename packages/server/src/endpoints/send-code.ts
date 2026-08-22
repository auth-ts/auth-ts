import { defineEndpoint } from "../http/define-endpoint"
import { resolveLocale } from "../http/resolve-locale"
import type { IdentifierBody } from "../magic-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../magic-code/resolve-code-identifier"
import { sendMagicCode } from "../magic-code/send-magic-code"

/** Body accepted by `POST /send-code`: exactly one identifier. */
export interface SendCodeInput extends IdentifierBody {
  /** Pre-resolved locale and headers, filled in from the request when over HTTP. */
  locale?: string
  headers?: Headers
}

/**
 * Sends a sign-in code.
 *
 * Always answers 200, even for an address that has never been seen. The user is
 * created when the code is verified, not here, so there is genuinely nothing to
 * enumerate — a different status for unknown addresses would turn this endpoint
 * into a "does this person have an account" oracle.
 */
export const sendCode = defineEndpoint({
  method: "POST",
  path: "/send-code",
  parse: async ({ request, internals }): Promise<SendCodeInput> => {
    const body = (await request.json().catch(() => ({}))) as IdentifierBody

    return {
      ...body,
      locale: resolveLocale(
        request.headers.get("accept-language"),
        internals.config.localization
      ),
      headers: request.headers
    }
  },
  run: async (internals, input: SendCodeInput) => {
    const identifier = resolveCodeIdentifier(internals, input)

    await sendMagicCode(internals, {
      identifier,
      purpose: "signIn",
      locale:
        input.locale ?? internals.config.localization?.defaultLocale ?? "en",
      headers: input.headers ?? new Headers()
    })

    return { data: { sent: true } }
  }
})
