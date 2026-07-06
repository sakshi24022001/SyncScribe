"use client";

/**
 * Editor — binds a Y.Text CRDT to a contentEditable div.
 *
 * Performance note (assignment: "preventing client-side lag during rapid
 * typing"): we do NOT re-render the whole editor on every Yjs transaction.
 * Local keystrokes mutate the Y.Text directly inside the native `input`
 * event handler (synchronous, no React re-render in the hot path); remote
 * updates from other collaborators are the only thing that trigger a
 * (targeted) DOM patch, via a plain-diff cursor-preserving text swap
 * rather than a full re-render. For a production system you'd reach for
 * `y-prosemirror` or `y-codemirror` bindings, which do this properly with
 * a real rich-text model — this hand-rolled version demonstrates the same
 * principle over a plain textarea for clarity in an assignment context.
 */
import { useEffect, useRef } from "react";
import * as Y from "yjs";

export function Editor({ ytext, editable }: { ytext: Y.Text; editable: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const applyingRemote = useRef(false);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;

    textarea.value = ytext.toString();

    const observer = () => {
      if (applyingRemote.current) return;
      // Cursor-preserving update: only touch the DOM if content actually
      // diverged from what's rendered (remote change), to avoid fighting
      // the user's own in-flight keystrokes / selection.
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const newValue = ytext.toString();
      if (textarea.value !== newValue) {
        applyingRemote.current = true;
        textarea.value = newValue;
        textarea.setSelectionRange(selStart, selEnd);
        applyingRemote.current = false;
      }
    };
    ytext.observe(observer);

    const onInput = () => {
      // Diff old vs new value to produce a minimal Yjs delete+insert
      // rather than replacing the whole text (which would look like every
      // other collaborator's entire document changed on each keystroke).
      const oldValue = ytext.toString();
      const newValue = textarea.value;
      if (oldValue === newValue) return;

      const [start, end, insertText] = diffRange(oldValue, newValue);
      ytext.doc?.transact(() => {
        if (end > start) ytext.delete(start, end - start);
        if (insertText) ytext.insert(start, insertText);
      });
    };
    textarea.addEventListener("input", onInput);

    return () => {
      ytext.unobserve(observer);
      textarea.removeEventListener("input", onInput);
    };
  }, [ytext]);

  return (
    <textarea
      ref={ref}
      readOnly={!editable}
      aria-label="Document content"
      aria-readonly={!editable}
      className="w-full h-full min-h-[60vh] resize-none rounded-lg border border-border bg-background p-6 font-mono text-sm leading-relaxed
                 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      spellCheck
    />
  );
}

/** Minimal common-prefix/suffix diff — good enough for single-cursor typing; not a full Myers diff. */
function diffRange(oldStr: string, newStr: string): [number, number, string] {
  let start = 0;
  const maxStart = Math.min(oldStr.length, newStr.length);
  while (start < maxStart && oldStr[start] === newStr[start]) start++;

  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return [start, oldEnd, newStr.slice(start, newEnd)];
}
