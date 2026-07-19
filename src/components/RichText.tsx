import { cn } from "@/lib/utils";
import { looksLikeHtml, sanitizeRichText } from "@/lib/sanitize";

/**
 * Renders an organizer-authored description on the public page. New content is
 * sanitized rich-text HTML from the Tiptap editor; legacy descriptions are
 * plain text (with newlines), so those fall back to `whitespace-pre-line` to
 * keep their line breaks. HTML is always run through the sanitizer first.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  if (!looksLikeHtml(html)) {
    return <p className={cn("whitespace-pre-line", className)}>{html}</p>;
  }
  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
    />
  );
}
