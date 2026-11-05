# AGENTS.md

## Commit messages

All Git commit messages must follow the Conventional Commits format:

```text
<type>[optional scope]: <description>
```

Use an imperative, concise description without a trailing period.

Allowed commit types:

- `feat`: add or extend user-facing functionality
- `fix`: correct a bug
- `docs`: change documentation only
- `test`: add or update tests
- `refactor`: restructure code without changing behavior
- `perf`: improve performance
- `style`: change formatting or styling without changing behavior
- `build`: change the build system or dependencies
- `ci`: change continuous integration configuration
- `chore`: make other maintenance changes
- `revert`: revert a previous commit

Examples:

```text
feat: add notes to Markdown Preview selections
fix(preview): restore highlights after switching files
test: cover note card navigation
docs: update extension usage guide
```

Breaking changes must include `!` after the type or scope and explain the change in the commit body or footer.
