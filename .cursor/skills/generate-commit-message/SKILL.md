---
name: generate-commit-message
description: >-
  Generates git commit messages following the Conventional Commits specification
  from staged or working-tree changes. Use when the user asks for a commit message,
  conventional commit, or help describing changes before commit; or when drafting
  the message step of a commit workflow without committing unless explicitly requested.
---

# Generate Commit Message

Produce a **Conventional Commits** message from the actual diff. Do not run `git commit` unless the user explicitly asked to commit.

## Gather context

Run in parallel when possible:

```bash
git status
git diff --staged
git diff
git log -10 --oneline
```

- Prefer **staged** changes for the message. If nothing is staged but there are modifications, base the message on unstaged diff and note that the user should stage files first.
- Match **tone and scope style** of recent commits in `git log` when present; otherwise follow this skill.

## Message format

```text
<type>(<scope>): <subject>

<body>

<footer>
```

| Part | Rules |
|------|--------|
| **type** | Required. One of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert` |
| **scope** | Optional. Short noun: module, package, or area (e.g. `api`, `docker`, `auth`) |
| **subject** | Imperative mood, **en-US**, lowercase start, no trailing period, ≤72 characters |
| **body** | Optional. Wrap at ~72 chars. Explain **why** and impact, not a file list |
| **footer** | Optional. `BREAKING CHANGE:`, `Refs #123`, `Co-authored-by:` |

### Type selection

| Type | When |
|------|------|
| `feat` | New behavior or capability for users |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace; no logic change |
| `refactor` | Code change without fixing a bug or adding a feature |
| `perf` | Performance improvement |
| `test` | Tests only |
| `build` | Build system, dependencies, Docker image build |
| `ci` | CI/CD, workflows, hooks in pipelines |
| `chore` | Maintenance, tooling, misc; default when unclear |
| `revert` | Reverts a prior commit; subject often references reverted SHA |

Use **one primary type** per commit. Split mixed changes into multiple suggested messages if the diff clearly spans unrelated concerns.

### Breaking changes

- Add `!` after type/scope: `feat(api)!: remove legacy endpoint`
- Or footer: `BREAKING CHANGE: describe migration`

## Repository conventions

- Commit **subject and body in en-US** (per project `AGENTS.md`).
- Focus on **why** the change exists, aligned with team commit style from `git log`.
- Do not commit secrets; warn if diff suggests `.env`, keys, or credentials.

## Output to the user

1. **Recommended message** — full text ready to paste (HEREDOC-friendly).
2. **One-line alternative** — if a shorter subject is enough.
3. **Brief rationale** — one or two sentences: type, scope, and how the diff drove the wording.

If changes are empty or only noise (e.g. accidental formatting), say so and suggest staging or discarding instead of inventing a message.

## Examples

**Staged: new REST endpoint for ride quotes**

```text
feat(api): add ride fare estimate endpoint

Expose POST /rides/estimate so clients can preview fares before booking.
```

**Staged: fix timezone in report**

```text
fix(reports): normalize dates to UTC in exports

Prevent off-by-one-day labels when generating CSV in non-UTC locales.
```

**Staged: Dockerfile and compose only**

```text
build(docker): multi-stage image for taxi-rio-app

Reduce final nginx image size and align with compose service names.
```

**Staged: README in Portuguese**

```text
docs: document local stack setup in README

Clarify docker compose profiles and required env vars for reviewers.
```

For more samples, see [examples.md](examples.md).

## Suggested commit command (only when user asked to commit)

After the user approves the message, commit with:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

EOF
)"
```

Do not amend, skip hooks, or push unless the user's rules explicitly allow it.
