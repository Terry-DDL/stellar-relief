# Vercel automatic production deployment

The existing Vercel project serves https://stellar-relief-v2.vercel.app/. Its project root is `web`, its framework is Vite, and its output directory is `dist`.

Vercel's native GitHub connection cannot be created by `yliu54977-bot`: the repository belongs to the personal account `Terry-DDL`, and the bot has collaborator access rather than ownership. The workflow in [`.github/workflows/vercel-production.yml`](../.github/workflows/vercel-production.yml) is an alternative that deploys this existing project after changes to `web` land on `main`.

To activate it, create a Vercel access token in the Vercel account that owns `stellar-relief-v2`, then save it as the GitHub Actions repository secret `VERCEL_TOKEN` in `Terry-DDL/stellar-relief`. The token grants deployment access to the Vercel account; only people trusted to edit workflows should have write access to this repository. Review the workflow before merging it to `main`.

The workflow also supports manual dispatch. The first production run should finish successfully and leave the public URL serving the V2 app. The project and owner IDs in the workflow identify the existing Vercel project and are not credentials.
