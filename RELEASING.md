# Releasing

Versioning and publishing are automated by `.github/workflows/release.yml`
(Changesets + npm trusted publishing with provenance). Nothing is published from
a laptop.

## One-time setup (maintainer)

1. On npmjs.com, add a **trusted publisher** for `react-native-punchlist`:
   GitHub Actions, repository `aivi-ai/react-native-punchlist`, workflow
   `release.yml`. No `NPM_TOKEN` is used or needed.
2. Allow GitHub Actions to create pull requests (repo settings → Actions).

## Each release

1. `npx changeset` in your feature PR; pick the bump and describe the change.
2. Merge. The workflow opens **chore: version packages**; merge it.
3. The workflow runs the full gate and publishes to the **`next`** dist-tag with
   provenance. Pre-1.0, breaking changes bump the minor.

## Promoting `next` to `latest`

Only after the device pass in `VALIDATION.md` (iOS Simulator, Android emulator,
web) is recorded as PASS:

```bash
npm dist-tag add react-native-punchlist@<version> latest
```

## Dry run

Any PR touching `.changeset/`, `package.json` or the workflow runs
`npm publish --dry-run` and uploads the tarball as an artifact.
