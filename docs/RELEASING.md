# Release strategy

This project uses a CI-first release flow:

```text
Pull Request → CI → merge to main → CI on main → CD → VS Code Marketplace
```

## CI

The `CI` workflow runs for pull requests targeting `main`, pushes to `main`, and manual dispatches. It performs:

- Type checking
- Unit tests
- Preview DOM E2E tests
- Real VS Code Preview UI E2E tests
- Release version validation on `main`

The main branch must pass CI before it can be released.

## Versioning rule

The extension version in `package.json` is the release version. Before merging a change to `main`, bump the version when a release tag already exists.

For example:

```bash
npm version patch --no-git-tag-version
```

Use `minor` for a backwards-compatible feature and `major` for a breaking change. Commit the resulting `package.json` and `package-lock.json` changes in the pull request.

The first release is allowed without an existing release tag. Later main-branch merges fail CI when the version is unchanged from the latest `v*` tag.

## CD

The `CD` workflow is triggered only after a successful `CI` run caused by a push to `main`. It:

1. Checks out the exact commit verified by CI.
2. Installs dependencies and compiles the extension.
3. Packages a VSIX with `@vscode/vsce`.
4. Publishes the VSIX to the Visual Studio Marketplace using OIDC Trusted Publishing.
5. Creates and pushes a matching `v<version>` Git tag.

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
