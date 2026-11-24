/**
 * Starts the shell for an interactive session. The shell is `$SHELL` if it is
 * set. If not, it is the login shell of the user in the passwd database, as
 * with `ssh`. If that is not usable, it is `sh`.
 *
 * Many images do not set `$SHELL`, and on Debian-based images `sh` is dash.
 * Dash has no line editing, so arrow keys and tab completion do not work.
 */
export const defaultShell = {
  command: "sh",
  args: [
    "-ic",
    `shell="\${SHELL:-}"
if [ -z "$shell" ]; then
  entry="$(getent passwd "$(id -u 2>/dev/null)" 2>/dev/null)"
  shell="\${entry##*:}"
  case "\${shell##*/}" in nologin|false) shell= ;; esac
  [ -x "$shell" ] || shell=sh
fi
case "\${shell##*/}" in
  bash) exec "$shell" --norc -i ;;
  *) exec "$shell" -i ;;
esac`,
  ],
};
