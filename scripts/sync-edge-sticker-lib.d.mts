// Types for the mirror script so the drift guard can import it under
// tsconfig's noImplicitAny.
export declare const SOURCE_DIR: string;
export declare const TARGET_DIR: string;
export declare function collect(
  dir: string,
  base?: string,
  out?: Map<string, string>,
  withHeader?: boolean,
): Map<string, string>;
export declare function readMirror(): Map<string, string>;
