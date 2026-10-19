export const defaultShell = {
  command: "sh",
  args: [
    "-ic",
    `shell="\${SHELL:-sh}"
case "\${shell##*/}" in
  bash) exec "$shell" --norc -i ;;
  *) exec "$shell" -i ;;
esac`,
  ],
};
