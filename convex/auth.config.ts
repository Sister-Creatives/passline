export default {
  providers: [
    {
      // CONVEX_SITE_URL is injected by the Convex deployment at runtime and is
      // the issuer of the JWTs minted by the Password provider.
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
