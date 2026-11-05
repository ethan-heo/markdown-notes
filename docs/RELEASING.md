# Release strategy

This project uses a CI-first release flow:

```text
Feature PR → CI → merge to main → Release PR → CI → merge release PR → CI → CD
```

## CI

The `CI` workflow runs for pull requests targeting `main`, pushes to `main`, and manual dispatches. It performs:

- Type checking
- Unit tests
- Preview DOM E2E tests
- Real VS Code Preview UI E2E tests

The main branch must pass CI before it can be released.

## Automated versioning

Release Please creates or updates a release PR after feature changes are merged into `main`. It determines the next version from Conventional Commits:

- `fix:` → patch version
- `feat:` → minor version
- `BREAKING CHANGE:` or `!` → major version

The release PR updates `package.json`, `package-lock.json`, and the changelog. Developers do not need to edit the version manually for each release.

Review and merge the release PR to approve the version bump and release.

### Release Please token

Some repositories restrict the default `GITHUB_TOKEN` from creating pull requests. This workflow therefore uses a dedicated `RELEASE_PLEASE_TOKEN` repository secret.

Create a fine-grained GitHub token limited to `ethan-heo/markdown-notes` with these repository permissions:

- Contents: Read and write
- Pull requests: Read and write

Add it at **Settings → Secrets and variables → Actions → New repository secret** with the name `RELEASE_PLEASE_TOKEN`.

## CD

The `CD` workflow is triggered only after a successful `CI` run for a merged Release Please commit. It:

1. Checks out the exact commit verified by CI.
2. Installs dependencies and compiles the extension.
3. Packages a VSIX with `@vscode/vsce`.
4. Publishes the VSIX to the Visual Studio Marketplace using OIDC Trusted Publishing.
5. Uses the GitHub release and matching `v<version>` tag created by Release Please.

## Trusted Publishing setup

The Marketplace Publisher ID is `ethan-heo`, which is declared in `package.json`.

Configure a Trusted Publishing policy in the Publisher management page:

1. Open the `ethan-heo` publisher.
2. Select the `Trusted Publishing` tab.
3. Create a policy with these values:

- Policy name: `GitHub Actions release`
- Repository: `ethan-heo/markdown-notes`
- Workflow: `.github/workflows/cd.yml`
- Environment: leave empty

The CD workflow requests the OIDC token with `id-token: write` and publishes with `npx @vscode/vsce publish --oidc`. No `VSCE_PAT` or `VSCE_PUBLISHER` GitHub Secret is required.

Trusted Publishing is preferable to storing a long-lived Marketplace PAT in GitHub Secrets.

For a private repository, run the configured workflow within 48 hours after creating the policy so the first token exchange can activate it.

## Manual checks before merging

```bash
npm test
npm run lint
npm run test:e2e
npm run test:e2e:ui
```
