import { useRef } from "react";
import { useDismissGuard } from "../lib/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  X,
  AlertCircle,
  ArrowDownUp,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  useId,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
export const Icon = ({
  as: C,
  size = 18,
  ...props
}: {
  as: LucideIcon;
  size?: number;
  className?: string;
}) => <C size={size} strokeWidth={1.7} {...props} />;
export function GemMark({ size = 39 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 46 46"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round">
        <path d="m3 16 9-9h22l9 9-20 25zM3 16h40M12 7l11 34L34 7M12 16l11-9 11 9" />
        <path d="m3 16 9 .1M23 41V21" opacity=".5" />
      </g>
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <GemMark />
      <div>
        <strong>
          Aurum<span>.</span>
        </strong>
        <small>JEWELLERY ERP</small>
      </div>
    </div>
  );
}
export function Ingots({ silver = false }: { silver?: boolean }) {
  const c = silver
    ? ["#d5dce2", "#a2acb7", "#798795"]
    : ["#f6d585", "#dcb362", "#ba9048"];
  return (
    <svg viewBox="0 0 36 32" width="29" height="26" aria-hidden="true">
      {[
        [2, 16],
        [17, 16],
        [9, 6],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path d="m2 2 9-2 3 3-10 2z" fill={c[0]} />
          <path d="m2 2 2 3-1 7-3-3z" fill={c[2]} />
          <path d="m4 5 10-2 2 6-13 3z" fill={c[1]} />
        </g>
      ))}
    </svg>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  routePanel = false,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  routePanel?: boolean;
  className?: string;
}) {
  const scope = useRef<HTMLDivElement>(null),
    guard = useDismissGuard();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => !v && guard(scope.current, onClose)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          ref={scope}
          data-route-panel={routePanel ? "" : undefined}
          className={`modal ${wide ? "wide" : ""} ${className}`}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <header className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description>{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </header>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  children,
  hint,
  full = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select {...props}>{children}</select>
      <ChevronDown size={14} />
    </span>
  );
}
export function Problem({ message }: { message?: string }) {
  return message ? (
    <div className="problem" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Empty({
  title = "No records yet",
  text = "New records will appear here.",
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>
        <Inbox size={25} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <i />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{children}</div>
    </header>
  );
}
export function Status({
  text,
  tone,
}: {
  text: string;
  /** Optional explicit colour ("green" | "yellow" | "red" | "grey") —
   * overrides the text-derived badge colour. Used by Girvi & EMI,
   * where the tone comes from loanStatusTone(). */
  tone?: string;
}) {
  return (
    <span
      className={
        "badge b-" + text.toLowerCase().replace(/\s+/g, "-") + (tone ? " tone-" + tone : "")
      }
    >
      <i />
      {text}
    </span>
  );
}
export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  const c = ["sage", "lavender", "sand", "blue", "rose"];
  return (
    <span className={"avatar a-" + c[index % 5]}>
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0])
        .join("")}
    </span>
  );
}
export type Column<T> = {
  label: string;
  value: (r: T) => ReactNode;
  sort?: (r: T) => string | number;
  align?: "right";
};
export function Records<T extends { id: string }>({
  items,
  columns,
  search,
  placeholder = "Search records…",
  title,
  action,
  empty = "No matching records",
  pageSize = 8,
  filters,
  rowClass,
}: {
  items: T[];
  columns: Column<T>[];
  search: (r: T) => string;
  placeholder?: string;
  title?: string;
  action?: (r: T) => void;
  empty?: string;
  pageSize?: number;
  filters?: ReactNode;
  /** Optional extra class per row (e.g. a status-colour accent). */
  rowClass?: (r: T) => string;
}) {
  const [query, Q] = useState(""),
    [sort, S] = useState<{ i: number; desc: boolean } | null>(null),
    [page, P] = useState(0);
  const label = useId();
  let data = items.filter((r) =>
    search(r).toLowerCase().includes(query.toLowerCase()),
  );
  const sorter = sort ? columns[sort.i]?.sort : null;
  if (sorter && sort)
    data = [...data].sort((a, b) => {
      const av = sorter(a),
        bv = sorter(b);
      return (
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv))) * (sort.desc ? -1 : 1)
      );
    });
  const max = Math.max(0, Math.ceil(data.length / pageSize) - 1),
    cur = Math.min(page, max);
  return (
    <section className="panel records">
      {title && <h2>{title}</h2>}
      <div className="table-toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            id={label}
            type="search"
            aria-label={placeholder}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              Q(e.target.value);
              P(0);
            }}
          />
        </label>
        {filters}
      </div>
      {data.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={c.label} className={c.align || ""}>
                    {c.sort ? (
                      <button
                        onClick={() => {
                          S({ i, desc: sort?.i === i ? !sort.desc : false });
                          P(0);
                        }}
                      >
                        {c.label}
                        <ArrowDownUp size={11} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(cur * pageSize, (cur + 1) * pageSize).map((r) => (
                <tr
                  key={r.id}
                  className={
                    (action ? "clickable" : "") +
                    (rowClass ? " " + rowClass(r) : "")
                  }
                  onClick={() => action?.(r)}
                  tabIndex={action ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (action && e.key === "Enter") action(r);
                  }}
                >
                  {columns.map((c) => (
                    <td key={c.label} className={c.align || ""}>
                      {c.value(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={empty}
          text={
            query
              ? "Try a different name or reference."
              : "Add a record to get started."
          }
        />
      )}
      <footer className="pager">
        <span>
          {data.length
            ? `${cur * pageSize + 1}–${Math.min(data.length, (cur + 1) * pageSize)} of ${data.length}`
            : "0"}{" "}
          records
        </span>
        <div>
          <button
            aria-label="Previous page"
            disabled={cur === 0}
            onClick={() => P(cur - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {cur + 1} / {max + 1}
          </span>
          <button
            aria-label="Next page"
            disabled={cur === max}
            onClick={() => P(cur + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}
