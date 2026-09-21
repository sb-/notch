/** Close page popovers before a native menu action opens another surface. */
export function withMenuDismissal<T extends Record<string, (...args: any[]) => unknown>>(
  actions: T,
  dismiss: () => void,
): T {
  return Object.fromEntries(Object.entries(actions).map(([name, action]) => [
    name,
    (...args: unknown[]) => {
      dismiss();
      return action(...args);
    },
  ])) as T;
}
