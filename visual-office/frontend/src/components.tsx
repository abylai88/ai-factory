import { Link, NavLink } from "react-router-dom";
import { useEvents } from "./hooks/useEvents.js";
import { useOffice } from "./store.js";

const NAV = [
  ["/dashboard", "Control room"],
  ["/projects", "Projects"],
  ["/pipelines", "Pipelines"],
  ["/agents", "Agents"],
  ["/events", "Events"],
  ["/diagnostics", "Diagnostics"],
  ["/visual-qa", "Visual QA"]
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  useEvents();
  const connected = useOffice(s => s.connected);

  return (
    <div className="shell">
      <aside>
        <div className="brand"><i>◈</i><span>VISUAL<br />OFFICE</span></div>
        <nav>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : undefined)}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="read-only">
          <span className={connected ? "dot online" : "dot"} />
          {connected ? "Live observer" : "Reconnecting"}
          <small>Read-only mode</small>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}

export function Badge({ value }: { value?: string }) {
  const key = (value ?? "unknown").toLowerCase().replace(/\s+/g, "-");
  return <span className={`badge ${key}`}>{value ?? "Unknown"}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Panel({ title, children, action, to }: {
  title: string;
  children: React.ReactNode;
  action?: string;
  to?: string;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>{title}</h2>
        {action && to && <Link to={to}>{action} →</Link>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function PageHeader({ eyebrow, title, badge }: { eyebrow: string; title: string; badge?: string }) {
  return (
    <header>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {badge && <Badge value={badge} />}
    </header>
  );
}

export function QueryState({ loading, error, empty, hasData, children }: {
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  hasData?: boolean;
  children: React.ReactNode;
}) {
  if (loading) return <div className="state loading"><span className="spinner" /> Loading factory data…</div>;
  if (error) return <div className="state error">Unable to load data: {error.message}</div>;
  if (empty || hasData === false) return <Empty text="No data reported by Factory." />;
  return <>{children}</>;
}

export function formatTime(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export function formatClock(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}

export function truncate(text: string, max = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
