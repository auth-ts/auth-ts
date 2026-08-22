# @auth-ts/cli

The command line for [`@auth-ts/server`](https://www.npmjs.com/package/@auth-ts/server).

```bash
bun x @auth-ts/cli keygen --out public
```

`keygen` generates an RS256 signing key (`--alg ES256` for the other) and a
server secret, prints them as the two `.env` lines `@auth-ts/server` reads —
`JWT_PRIVATE_KEY` and `AUTH_SECRET` — and writes the public key set to
`public/jwks.json`, which your framework serves at `/jwks.json`. Point Neon, or
anything else that trusts a JWKS URL, there.

Copy the two lines into your `.env`. They are the whole of stdout and
everything else goes to stderr, so they pipe cleanly if you would rather. To
rotate, run it again and deploy the new key and the new file together.

Full documentation: [authts.dev](https://authts.dev)
