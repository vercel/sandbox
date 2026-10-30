---
"sandbox": minor
---

Add the experimental `--credentials-*` surface for managed GitHub credentials.
`--enable-managed-credentials` selects the complete default experience,
inferring the repository and clone source from the local Git remotes, the
commit credit from the effective local Git configuration, and the GitHub API
actor from `gh` (falling back to the GitHub account linked to Vercel only when
`gh` is not logged in).

`--credentials-action` requests GitHub API actions and replaces the default set
rather than adding to it, while Git access stays independent: `git:write` by
default, or a read-only clone with `--credentials-no-write`, which also omits
the inferred commit credit. `--credentials-repo`, `--credentials-commit-as`,
and `--credentials-act-as` override individual inferred values.

Multiple repositories, action sets, and identities are expressed with
`--credentials-from-config-file`, and a configuration can be copied from an
existing sandbox with `--credentials-from-sandbox` (by name or `sbx_*`
identifier, through a read-only lookup that never resumes it) or saved with
`--credentials-persist-configuration`. Explicit configurations never acquire
the inferred defaults, and commit metadata never upgrades a read-only source.

Creation shows one complete proposal for a single Create/Edit/Cancel approval,
re-running dependent inference and the permission check after a correction.
Managed-credential creations default to 6 vCPUs, which an explicit `--vcpus`
overrides. A new `--dry-run` resolves and displays the configuration without
creating a sandbox, changing policy, or writing files.

The earlier `--git-source`, `--github*`, `--commit-as-*`, and
`--managed-credentials-file` options keep working and are documented with their
replacements; they cannot be combined with the `--credentials-*` options.
