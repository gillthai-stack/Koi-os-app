import type { ReactNode } from "react";
import { Form, NavLink } from "react-router";
import { KOI_SVG, SUN_HTML } from "./art";

type User = { displayName: string; role: "OWNER" | "STAFF" };

export function Pond() {
  return (
    <div className="pond" aria-hidden="true">
      <span className="ring" />
      <span className="ring" />
      <span className="ring" />
      <div dangerouslySetInnerHTML={{ __html: KOI_SVG }} />
    </div>
  );
}

export function Shell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="bg shell">
      <aside className="side">
        <Pond />
        <div className="logo" style={{ textAlign: "center" }}>
          KOI<span className="glow-m">{"//"}</span>OS
        </div>
        <nav className="side-nav">
          <NavLink to="/" end className={({ isActive }) => `nav${isActive ? " on" : ""}`}>
            <span className="dot" />
            Reorder
          </NavLink>
          <NavLink to="/requests" className={({ isActive }) => `nav${isActive ? " on" : ""}`}>
            <span className="dot" />
            Requests
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => `nav${isActive ? " on" : ""}`}>
            <span className="dot" />
            Orders
          </NavLink>
          <NavLink to="/digest" className={({ isActive }) => `nav${isActive ? " on" : ""}`}>
            <span className="dot" />
            Digest
          </NavLink>
          {user.role === "OWNER" && (
            <NavLink to="/team" className={({ isActive }) => `nav${isActive ? " on" : ""}`}>
              <span className="dot" />
              Team
            </NavLink>
          )}
        </nav>
        <div className="side-foot">
          <div className="muted" style={{ fontSize: 13 }}>
            Signed in as <strong style={{ color: "#fff" }}>{user.displayName}</strong>
          </div>
          <Form method="post" action="/logout">
            <button className="btn" type="submit" style={{ width: "100%" }}>
              Log out
            </button>
          </Form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function Hero({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="hero">
      <div className="floor" />
      <div style={{ position: "relative", zIndex: 1, paddingBottom: 26, minWidth: 0 }}>
        <div className="kicker">{kicker}</div>
        <h1 className="h" style={{ margin: "6px 0 10px", fontSize: "clamp(28px,4vw,40px)" }}>
          {title}
        </h1>
        {children}
      </div>
      <div className="hero-art" dangerouslySetInnerHTML={{ __html: SUN_HTML }} />
    </section>
  );
}

/** Centered card for login and setup pages. */
export function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg gate">
      <div className="card gate-card fade">
        <Pond />
        <div className="logo" style={{ textAlign: "center", margin: "10px 0 4px" }}>
          KOI<span className="glow-m">{"//"}</span>OS
        </div>
        <h1 className="h muted" style={{ textAlign: "center", fontSize: 16, margin: "0 0 18px" }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
