# @auth-ts/cli

The command line for [`@auth-ts/core`](https://www.npmjs.com/package/@auth-ts/core).

```bash
npx @auth-ts/cli keygen
```

`keygen` generates a signing key and the public key set that verifies tokens
signed with it. It prints both, then asks whether to append the key to `.env`
and write the key set to `public/jwks.json`. Nothing is written unless you say
so, and a variable the env file already sets is never overwritten without being
asked about first.

Existing assignments are recognized with indentation, `export`, or spaces
around `=`. Keeping a key also keeps its existing `jwks.json`. Approved
replacement updates every assignment of that variable, including duplicates.

`--out` moves the key set, `--env` moves the variable, and `--alg RS256` switches
from the default ES256. `--yes` skips the save question; replacing an existing
key still requires an interactive answer. An unreadable env file stops the
command before either file is written.

Full documentation: [authts.dev](https://authts.dev/docs/reference/cli)
