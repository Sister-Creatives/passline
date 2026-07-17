/**
 * Strip a tracking-pixel id down to the characters a Meta Pixel / GA / GTM id
 * ever legitimately contains. Client-side mirror of `sanitizePixelId` in
 * `convex/marketing.ts` -- applied again here, immediately before
 * interpolating the id into this page's inline `<script>`, so a stored id
 * (already sanitized server-side, but re-checked as defense in depth) can
 * never break out of the script tag it's injected into.
 */
function sanitizePixelId(id: string): string {
  return id.replace(/[^A-Za-z0-9-]/g, "");
}

interface TrackingPixelsProps {
  metaPixelId?: string;
  googleAnalyticsId?: string;
  gtmId?: string;
}

/**
 * Renders the standard GA4 (gtag.js), Google Tag Manager, and Meta Pixel
 * bootstrap snippets for whichever ids are configured on the event, with
 * each id re-sanitized to `[A-Za-z0-9-]` right before interpolation into the
 * inline script. Renders nothing when none of the three ids are set.
 */
export function TrackingPixels({ metaPixelId, googleAnalyticsId, gtmId }: TrackingPixelsProps) {
  const ga = googleAnalyticsId ? sanitizePixelId(googleAnalyticsId) : "";
  const gtm = gtmId ? sanitizePixelId(gtmId) : "";
  const meta = metaPixelId ? sanitizePixelId(metaPixelId) : "";

  if (!ga && !gtm && !meta) return null;

  return (
    <>
      {ga && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${ga}";document.head.appendChild(s);})();window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","${ga}");`,
          }}
        />
      )}
      {gtm && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":new Date().getTime(),event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!="dataLayer"?"&l="+l:"";j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i+dl;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","${gtm}");`,
          }}
        />
      )}
      {meta && (
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init","${meta}");fbq("track","PageView");`,
          }}
        />
      )}
    </>
  );
}
