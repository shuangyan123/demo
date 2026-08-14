export type SquirrelLifecycleEvent =
  | "install"
  | "updated"
  | "uninstall"
  | "obsolete";

const lifecycleArguments = new Map<string, SquirrelLifecycleEvent>([
  ["--squirrel-install", "install"],
  ["--squirrel-updated", "updated"],
  ["--squirrel-uninstall", "uninstall"],
  ["--squirrel-obsolete", "obsolete"],
]);

/**
 * Squirrel invokes the app executable for install/update/uninstall cleanup.
 * Keep this classification pure so `--squirrel-firstrun` remains a normal app launch.
 */
export function classifySquirrelLifecycleInvocation(
  argv: readonly string[],
): SquirrelLifecycleEvent | undefined {
  for (const argument of argv) {
    const event = lifecycleArguments.get(argument);
    if (event) return event;
  }
  return undefined;
}

export function isSquirrelLifecycleInvocation(argv: readonly string[]): boolean {
  return classifySquirrelLifecycleInvocation(argv) !== undefined;
}
