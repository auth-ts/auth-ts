# @auth-ts/cli

The command line for [`@auth-ts/server`](https://www.npmjs.com/package/@auth-ts/server).

```bash
npx @auth-ts/cli keygen >> .env
```

`keygen` generates an RS256 signing key (`--alg ES256` for the other) and a
server secret, prints them as the two `.env` lines `@auth-ts/server` reads —
`JWT_PRIVATE_KEY` and `AUTH_SECRET` — and writes the public key set to
`public/jwks.json`, which your framework serves at `/jwks.json`. Point Neon, or
anything else that trusts a JWKS URL, there.

The `.env` lines go to stdout and everything else to stderr, so the redirect
above appends exactly the two variables. To rotate, run it again and deploy the
new key and the new file together.

Full documentation: [authts.dev](https://authts.dev)
