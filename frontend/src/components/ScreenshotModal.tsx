import { useEffect, useId, useRef, type ChangeEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Plus, Trash2, X } from "lucide-react";

export type ScreenshotItem = {
  id: string;
  src: string;
  label: string;
  /** Analyst upload — can be removed; revoke blob URL on remove. */
  removable?: boolean;
};

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  items: ScreenshotItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onDownload: (item: ScreenshotItem) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemove: (item: ScreenshotItem) => void;
};

export default function ScreenshotModal({
  open,
  title,
  subtitle,
  items,
  activeId,
  onSelect,
  onClose,
  onDownload,
  onAddFiles,
  onRemove
}: Props) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const active = items.find((item) => item.id === activeId) || items[0] || null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !active) return null;

  const stop = (event: MouseEvent) => event.stopPropagation();

  const pickFiles = () => fileRef.current?.click();

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onAddFiles(event.target.files);
    event.target.value = "";
  };

  return createPortal(
    <div
      className="screenshot-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div className="screenshot-modal-panel" onClick={stop}>
        <header className="screenshot-modal-head">
          <div className="screenshot-modal-titles">
            <strong id={titleId}>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <div className="screenshot-icon-actions" role="toolbar" aria-label="Screenshot actions">
            <button
              type="button"
              className="screenshot-icon-btn"
              aria-label="Download screenshot"
              title="Download"
              onClick={() => onDownload(active)}
            >
              <Download size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="screenshot-icon-btn"
              aria-label="Add screenshot"
              title="Add"
              onClick={pickFiles}
            >
              <Plus size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="screenshot-icon-btn danger"
              aria-label="Remove screenshot"
              title="Remove"
              disabled={active.removable === false}
              onClick={() => onRemove(active)}
            >
              <Trash2 size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="screenshot-icon-btn"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="screenshot-modal-body">
          <img src={active.src} alt={active.label} className="screenshot-modal-image" />
        </div>

        {items.length > 1 ? (
          <div className="screenshot-modal-thumbs" role="tablist" aria-label="Screenshots">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === active.id}
                className={`screenshot-modal-thumb ${item.id === active.id ? "active" : ""}`}
                onClick={() => onSelect(item.id)}
                title={item.label}
              >
                <img src={item.src} alt="" />
              </button>
            ))}
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={onFileChange}
        />
      </div>
    </div>,
    document.body
  );
}

export async function downloadScreenshot(item: ScreenshotItem, filenameHint?: string): Promise<void> {
  const fallback = filenameHint || item.label || "screenshot";
  const safeName = fallback.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "screenshot";
  try {
    const response = await fetch(item.src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const ext =
      blob.type === "image/jpeg"
        ? "jpg"
        : blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/gif"
            ? "gif"
            : "png";
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeName.toLowerCase().endsWith(`.${ext}`)
      ? safeName
      : `${safeName}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(item.src, "_blank", "noopener,noreferrer");
  }
}
