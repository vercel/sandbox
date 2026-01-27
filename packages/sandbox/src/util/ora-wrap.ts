import type { Ora } from "ora";
import wrapAnsi from "wrap-ansi";

/**
 * Creates a wrapper around an Ora spinner instance that automatically
 * wraps text to fit within the terminal width.
 *
 * Listens to terminal resize events and re-wraps the text accordingly.
 *
 * @example
 * using wrap = createOraWrap(spinner);
 * wrap.text = "This is a long message that will be wrapped";
 */
export function createOraWrap(ora: Ora): OraWrap {
  let currentText = "";

  const updateText = () => {
    const columns = process.stdout.columns ?? 80;
    // Reserve space for spinner (2 chars) + space
    const availableWidth = Math.max(columns - 3, 10);
    ora.text = wrapAnsi(currentText, availableWidth, { hard: true });
  };

  const onResize = () => updateText();
  process.stdout.on("resize", onResize);

  return new Proxy(ora, {
    get(target, prop) {
      if (prop === "text") {
        return currentText;
      }
      if (prop === Symbol.dispose) {
        return () => process.stdout.off("resize", onResize);
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (prop === "text") {
        currentText = value;
        updateText();
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  }) as OraWrap;
}

export type OraWrap = Ora & Disposable;
