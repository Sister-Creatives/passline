import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Tiptap rich-text editor for the event description. Controlled via `value`
 * (HTML) / `onChange`, so it drops into the existing react-hook-form field.
 * An empty document is reported as `""` (not `<p></p>`) so the form's
 * "required" check still catches a blank description. It renders on the event
 * builder only (a client, authed route), so Tiptap is code-split there and
 * `immediatelyRender: false` keeps SSR hydration clean.
 */
export function RichTextEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-40 px-3 py-2 focus:outline-none",
      },
    },
  });

  if (!editor) {
    return <div className={cn("min-h-52 rounded-md border border-input", className)} />;
  }

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // Re-render the toolbar on every editor transaction so the active states
  // (bold on/off, etc.) track the cursor.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const update = () => force();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  // The link editor is our own Dialog rather than window.prompt, so it matches
  // the app's styling and keyboard behavior. Opening the dialog moves DOM focus
  // out of the editor, but ProseMirror keeps its selection in state -- the
  // `.focus()` in each handler restores it before the link mark is applied.
  const hasLink = editor.isActive("link");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("https://");
  const linkInputRef = useRef<HTMLInputElement>(null);

  function openLinkDialog() {
    const previous = editor.getAttributes("link").href as string | undefined;
    setLinkValue(previous ?? "https://");
    setLinkOpen(true);
  }

  function applyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = linkValue.trim();
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  const items = [
    { icon: Bold, label: "Bold", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, label: "Italic", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { icon: Heading2, label: "Heading", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Heading3, label: "Subheading", active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: List, label: "Bullet list", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, label: "Numbered list", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: Quote, label: "Quote", active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: LinkIcon, label: "Link", active: hasLink, run: openLinkDialog },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 p-1">
        {items.map(({ icon: Icon, label, active, run }) => (
          <Button
            key={label}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            onClick={run}
          >
            <Icon />
          </Button>
        ))}
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          className="sm:max-w-md"
          // Focus the URL field (and select its contents) on open; keep focus
          // from snapping back to the toolbar button on close so our handlers'
          // editor.focus() wins and the caret returns to the text.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            linkInputRef.current?.focus();
            linkInputRef.current?.select();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{hasLink ? "Edit link" : "Add link"}</DialogTitle>
            <DialogDescription>Where should this text link to?</DialogDescription>
          </DialogHeader>
          <form onSubmit={applyLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rte-link-url">Link URL</Label>
              <Input
                id="rte-link-url"
                ref={linkInputRef}
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                value={linkValue}
                onChange={(event) => setLinkValue(event.target.value)}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              {hasLink ? (
                <Button type="button" variant="outline" onClick={removeLink} className="mr-auto">
                  Remove link
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
