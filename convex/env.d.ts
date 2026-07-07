// Narrow ambient declaration for the one Node-ish global Convex supports outside
// "use node" actions: process.env (used in auth.config.ts). Declaring only this,
// instead of pulling all of @types/node via "types": ["node"], keeps Node-only
// APIs (Buffer, require, fs, __dirname, ...) as type errors — they do not exist in
// Convex's default V8 isolate runtime and would otherwise throw at runtime.
declare const process: {
  env: Record<string, string | undefined>;
};
