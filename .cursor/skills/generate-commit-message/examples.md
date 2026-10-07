# Conventional commit examples

Reference only — agent reads when examples in SKILL.md are not enough.

## Multiple scopes in one diff

Suggest **split commits** when possible:

```text
# Commit 1
feat(app): add driver availability toggle

# Commit 2
test(api): cover driver status webhook handler
```

If the user insists on one commit, prefer the dominant type and mention both areas in the body.

## Revert

```text
revert: feat(api): add ride fare estimate endpoint

This reverts commit a1b2c3d4.
```

## CI-only change

```text
ci: run integration tests on pull requests

Add workflow triggered on PRs targeting main with compose health checks.
```

## Dependency bump (no app logic)

```text
build(deps): bump spring boot to 3.4.2

Address CVE in transitive dependency reported by dependabot.
```

## Typo in user-facing string

```text
fix(i18n): correct boarding point label in pt-BR locale
```

## Large refactor

```text
refactor(api): extract ride pricing into dedicated service

Simplify controller layer and enable unit tests without HTTP layer.
```
