export type DiagnosticIOOperation = "lstatSync" | "openSync" | "fstatSync" | "readFileSync" | "closeSync"
  | "writeFileSync" | "linkSync" | "renameSync" | "unlinkSync";
export type DiagnosticIOFailure = Readonly<{
  operation: DiagnosticIOOperation;
  ioCode: string | null;
  syscall: string | null;
  errno: number | null;
}>;
