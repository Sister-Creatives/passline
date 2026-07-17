/**
 * @convex-dev/auth throws plain Errors whose messages can contain a stack
 * trace (leaking internal paths like node_modules) or, on signup, the user's
 * own email address. Neither is safe to show in a toast. In production,
 * Convex redacts non-ConvexError messages down to a generic "Server Error"
 * string, so the marker-based branches below only ever fire in dev — the
 * fallback is what production traffic will almost always hit, and it must
 * read as plausible whether the cause was a bad credential or a transient
 * outage. Sign-in deliberately collapses "no such account" and "wrong
 * password" into one message to avoid revealing which emails have accounts.
 */
export function authErrorMessage(error: unknown, flow: "signIn" | "signUp"): string {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("TooManyFailedAttempts")) {
    return "Too many failed attempts. Please wait a moment and try again.";
  }
  if (message.includes("already exists")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (message.includes("InvalidAccountId") || message.includes("InvalidSecret")) {
    return "Invalid email or password.";
  }

  return flow === "signIn"
    ? "Couldn't sign you in. Check your email and password, or try again shortly."
    : "Couldn't create your account. Please try again.";
}
