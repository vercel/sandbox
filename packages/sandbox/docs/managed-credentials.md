# Managed credentials

Managed credentials let a sandbox use services on your behalf without a secret inside the sandbox. Request them when you create a sandbox with `sandbox create`, `sandbox run`, or `sandbox sh`.

| Credentials | What the sandbox can do                             | Status       |
| ----------- | --------------------------------------------------- | ------------ |
| `npm`       | Install your team's private npm packages            | Available    |
| `github`    | Use Git and the GitHub API on repositories you name | Experimental |

## npm

```sh
sandbox create --credentials=npm
```

The sandbox can install your team's private packages. The CLI does not ask for confirmation.

## GitHub

### Quick start

Run this inside a clone of a GitHub repository:

```sh
sandbox create --credentials=github
```

The CLI clones that repository into the sandbox and requests the default actions on it: `github:issues:read`, `github:issues:comment`, `github:pull-request:create`, and `git:write`. That is enough to read an issue and open a pull request for it. No GitHub token is placed inside the sandbox.

### Choose the repository, actions, or account

| Option                                         | Meaning                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `--credentials-github-repository <REPOSITORY>` | The repository, as `OWNER/REPOSITORY`. It is also cloned into the sandbox.      |
| `--credentials-github-actions <ACTION,...>`    | A comma-separated list that replaces the default actions, including Git access. |
| `--credentials-github-act-as <USER>`           | The GitHub account to act as: a username or a numeric user ID.                  |

```sh
sandbox create \
  --credentials-github-repository=acme/web \
  --credentials-github-actions=git:read,issues:read
```

- `github` in `--credentials` asks for the defaults. Giving it together with a `--credentials-github-*` option is an error. To state values yourself, leave `github` out of `--credentials`.
- `--credentials=npm` combines with the `--credentials-github-*` options.
- Without `--credentials-github-repository`, the other two options apply to the repository of the current directory.
- Without `--credentials-github-actions`, the request has the default actions.
- GitHub API actions may drop the `github:` prefix on the command line: `issues:read` is `github:issues:read`. Git actions always keep `git:`.
- An account name made only of digits needs an `@` prefix, because digits alone are read as a user ID.

### Actions

| Action                               | Access                                             |
| ------------------------------------ | -------------------------------------------------- |
| `git:read`                           | Clone and fetch                                    |
| `git:write`                          | Push, except workflow files and forced pushes      |
| `git:write-workflows`                | Push changes to workflow files                     |
| `git:force-push`                     | Force-push                                         |
| `github:pull-request:create`         | Open pull requests                                 |
| `github:pull-request:get`            | Read pull requests                                 |
| `github:pull-request:update`         | Update pull requests                               |
| `github:pull-request:comment`        | Comment on pull requests                           |
| `github:issues:read`                 | Read issues                                        |
| `github:issues:create`               | Open issues                                        |
| `github:issues:update`               | Update issues                                      |
| `github:issues:comment`              | Comment on issues                                  |
| `github:labels:read`                 | Read labels                                        |
| `github:labels:write`                | Create labels and change the labels on issues      |
| `github:ci-status:read`              | Read check runs and commit statuses                |
| `github:repository:read`             | Read repository metadata                           |
| `github:repository-permissions:read` | Read a collaborator's permission on the repository |

### Which repository the CLI finds

The CLI reads the Git remotes of the current directory. It uses `origin` when that is a github.com HTTPS or SSH URL. Without such an `origin`, it uses the other GitHub remotes only when they all name the same repository. It never picks between different repositories. When it finds none, pass `--credentials-github-repository`.

### Which GitHub account is used

When you do not pass `--credentials-github-act-as`, the Vercel API decides:

- For a logged-in user, it uses the GitHub account connected to that Vercel user. Creation fails if no GitHub account is connected.
- A caller that is not a user, such as a project OIDC token, must pass `--credentials-github-act-as`.
- A request with only `git:read` uses no account.

### Review and confirmation

Before it creates a sandbox with GitHub access, the CLI shows the request and asks:

```text
  Team            acme
  Project         web
  Repository      acme/web
  Actions         github:issues:read
                  github:issues:comment
                  github:pull-request:create
                  git:write
  GitHub account  your connected GitHub account

Create this sandbox? (y/N)
```

- The team and project appear exactly as the request uses them: as you passed them, or as IDs when the CLI worked them out.
- Only `y` or `yes` approves. Any other answer cancels, and nothing is created.
- When the CLI filled in the repository or the actions and you do not approve, it prints the command that states the request in full. Edit that command and run it. The CLI leaves the command out if the team or project contains characters that a shell could read as syntax.
- `--yes` (`-y`) skips the request and the questions.
- When nobody can answer, for example in CI, under an AI agent, or with input redirected, the CLI shows the request and stops unless you pass `--yes`.

### Project Bounds

Bounds are project-wide limits on the GitHub access that the sandboxes of a project can request. After you approve a request, the CLI reads the Bounds of the project.

- When the project has Bounds, the API enforces them.
- When it has none, the CLI warns that nothing limits the access its sandboxes can request, and asks `Continue without project Bounds? (y/N)`. With `--yes`, it prints the warning and continues.
- When the Bounds cannot be read, the CLI stops. It never treats that as a project without Bounds.

The CLI never creates or changes Bounds.

### Several repositories: a credentials file

`--credentials-file <FILE>` reads the whole request as JSON, in the shape of the SDK's `credentials` option. Use `-` to read stdin.

```json
{
  "npm": true,
  "github": [
    {
      "repositories": ["acme/web", "acme/api"],
      "actions": ["git:write", "github:pull-request:create"],
      "actAs": "@octocat"
    },
    {
      "repositories": ["acme/docs"],
      "actions": ["github:issues:read"]
    }
  ]
}
```

- Each entry of `github` grants its `actions` on its `repositories`.
- Actions use their full names. `actAs` is a numeric user ID as a string, or a username with an `@` prefix.
- Unknown keys are rejected, and errors name the path of a problem without printing its value.
- Nothing is cloned into the sandbox.
- The file cannot be combined with `--credentials` or the `--credentials-github-*` options.

### Save a request and use it again

```sh
sandbox create --credentials=github --credentials-output=credentials.json
sandbox create --credentials-file=credentials.json
```

`--credentials-output <FILE>` writes the request of the sandbox that was just created, in the format that `--credentials-file` reads. The CLI checks the path before it creates the sandbox and never overwrites a file. The file does not record the team, the project, or the repository to clone.

### Exit codes

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| `0`   | The sandbox was created.                               |
| `1`   | The command failed, including an invalid option.       |
| `2`   | The request needs a confirmation that nobody can give. |
| `130` | You declined the request.                              |
