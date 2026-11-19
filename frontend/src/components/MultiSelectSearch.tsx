import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type MultiSelectOption = {
  id: string;
  label: string;
  description?: string;
  searchText?: string;
};

type Props = {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  noMatchesLabel?: string;
  label?: string;
};

export default function MultiSelectSearch({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Select options…",
  searchPlaceholder = "Search…",
  emptyLabel = "No options available",
  noMatchesLabel = "No matches",
  label
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.id)),
    [options, selectedSet]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.description || ""} ${option.searchText || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange(value.filter((item) => item !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const remove = (id: string) => {
    if (disabled) return;
    onChange(value.filter((item) => item !== id));
  };

  return (
    <div className={`multi-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
      {label ? <span className="multi-select-label">{label}</span> : null}

      <button
        type="button"
        className="multi-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <div className="multi-select-chips">
          {selectedOptions.length ? (
            selectedOptions.map((option) => (
              <span key={option.id} className="multi-select-chip">
                <span className="multi-select-chip-label">{option.label}</span>
                <span
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  className="multi-select-chip-remove"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(option.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      remove(option.id);
                    }
                  }}
                >
                  <X size={12} aria-hidden />
                </span>
              </span>
            ))
          ) : (
            <span className="multi-select-placeholder">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={16} className="multi-select-caret" aria-hidden />
      </button>

      {open ? (
        <div className="multi-select-panel" role="presentation">
          <div className="multi-select-search">
            <Search size={14} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              disabled={disabled}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const first = filtered[0];
                  if (first) toggle(first.id);
                }
              }}
            />
          </div>

          {!options.length ? (
            <div className="multi-select-empty">{emptyLabel}</div>
          ) : !filtered.length ? (
            <div className="multi-select-empty">{noMatchesLabel}</div>
          ) : (
            <ul id={listId} className="multi-select-list" role="listbox" aria-multiselectable="true">
              {filtered.map((option) => {
                const checked = selectedSet.has(option.id);
                return (
                  <li key={option.id} role="option" aria-selected={checked}>
                    <button
                      type="button"
                      className={`multi-select-option ${checked ? "is-selected" : ""}`}
                      disabled={disabled}
                      onClick={() => toggle(option.id)}
                    >
                      <span className={`multi-select-check ${checked ? "is-checked" : ""}`}>
                        {checked ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
                      </span>
                      <span className="multi-select-option-text">
                        <strong>{option.label}</strong>
                        {option.description ? <span>{option.description}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
