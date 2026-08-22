# @auth-ts/cli

The command line for [`@auth-ts/server`](https://www.npmjs.com/package/@auth-ts/server).

```bash
bun x @auth-ts/cli keygen
```

`keygen` generates a signing key, a server secret, and the public key set that
verifies tokens signed with it. It prints all three, then asks whether to append
the two variables to `.env` and write the key set to `public/jwks.json`. Nothing
is written unless you say so, and a variable the env file already sets is never
overwritten without being asked about first.

`--out` moves the key set, `--env` moves the variables, `--yes` skips the
question, and `--alg ES256` picks the other algorithm.

Full documentation: [authts.dev](https://authts.dev/docs/reference/cli)
