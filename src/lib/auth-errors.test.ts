import { expect, test } from "vitest";
import { authErrorMessage } from "./auth-errors";

test("maps a rate-limit error to a wait-and-retry message", () => {
  expect(authErrorMessage(new Error("TooManyFailedAttempts"), "signIn")).toBe(
    "Too many failed attempts. Please wait a moment and try again.",
  );
});

test("maps a duplicate signup error to an already-exists message", () => {
  expect(authErrorMessage(new Error("Account someone@example.com already exists"), "signUp")).toBe(
    "An account with that email already exists. Sign in instead.",
  );
});

test("maps invalid account and invalid secret to the same generic message", () => {
  expect(authErrorMessage(new Error("InvalidAccountId"), "signIn")).toBe("Invalid email or password.");
  expect(authErrorMessage(new Error("InvalidSecret"), "signIn")).toBe("Invalid email or password.");
});

test("falls back to a non-committal message for an unrecognized signIn failure", () => {
  expect(authErrorMessage(new Error("NetworkError: failed to fetch"), "signIn")).toBe(
    "Couldn't sign you in. Check your email and password, or try again shortly.",
  );
});

test("falls back to a non-committal message for signUp", () => {
  expect(authErrorMessage(new Error("[Request ID: abc] Server Error"), "signUp")).toBe(
    "Couldn't create your account. Please try again.",
  );
});

test("strips stack traces and internal paths from a realistic dev error", () => {
  const error = new Error(
    "[Request ID: 4b954b32] Server Error\nUncaught Error: InvalidAccountId\n    at retrieveAccount (../../node_modules/@convex-dev/auth/src/server/implementation/index.ts:602:9)",
  );
  const message = authErrorMessage(error, "signIn");
  expect(message).not.toContain("retrieveAccount");
  expect(message).not.toContain("node_modules");
  expect(message).not.toContain("Uncaught");
});

test("never leaks the email embedded in a duplicate-signup error", () => {
  const message = authErrorMessage(new Error("Account someone@example.com already exists"), "signUp");
  expect(message).not.toContain("someone@example.com");
});

test("handles a production-redacted error by hitting the signIn fallback", () => {
  expect(authErrorMessage(new Error("[Request ID: abc] Server Error"), "signIn")).toBe(
    "Couldn't sign you in. Check your email and password, or try again shortly.",
  );
});

test("handles non-Error inputs without throwing", () => {
  expect(authErrorMessage("boom", "signIn")).toBe(
    "Couldn't sign you in. Check your email and password, or try again shortly.",
  );
  expect(authErrorMessage(undefined, "signUp")).toBe("Couldn't create your account. Please try again.");
});

test("prioritizes the rate-limit marker over credential markers in the same message", () => {
  expect(
    authErrorMessage(new Error("TooManyFailedAttempts: InvalidAccountId InvalidSecret"), "signIn"),
  ).toBe("Too many failed attempts. Please wait a moment and try again.");
});
