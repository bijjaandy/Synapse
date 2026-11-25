"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { LogOut, ShieldAlert } from "lucide-react";
import { checkHealth, checkSession, logout, type Role, type Session } from "@/lib/api";
import { useLang } from "@/lib/voice";

export const PAGES: { href: string; label: string; roles: Role[] }[] = [
  { href: "/train", label: "Train", roles: ["operator", "inspector", "supervisor"] },
  { href: "/inspect", label: "Inspect", roles: ["operator", "inspector", "supervisor"] },
  { href: "/evaluation", label: "Evaluation", roles: ["inspector", "supervisor"] },
  { href: "/objects", label: "Object library", roles: ["operator", "inspector", "supervisor"] },
  { href: "/history", label: "History", roles: ["operator", "inspector", "supervisor"] },
  { href: "/summary", label: "Summary", roles: ["supervisor"] },
];

export function BrandMark({ small = false }: { small?: boolean }) {
  return <Link href="/" className={`netrix-brand ${small ? "small" : ""}`} aria-label="Netrix IQ home">
    <img src="/brand/netrix-mark.png" alt="" className="netrix-mark" />
    <span><strong>NETRIX IQ</strong><small>Learn from perfection. Detect the rest.</small></span>
  </Link>;
}

/** Logged-in pages: top bar with the pages this role may open; sends visitors without a session to /login. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname() ?? "/inspect";
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const { data: serverOk } = useSWR("backend-health", checkHealth, { refreshInterval: 5000 });
  const [lang, setLang] = useLang();

  useEffect(() => {
    checkSession().then((s) => {
      setSession(s);
      if (!s) router.replace(`/login?next=${encodeURIComponent(path)}`);
    });
  }, [path, router]);

  const page = PAGES.find((p) => path.startsWith(p.href));
  const allowed = session && (!page || page.roles.includes(session.role));

  return <div className="netrix-app">
    <header className="netrix-topbar">
      <BrandMark small />
      {session && <nav aria-label="Pages">{PAGES.filter((p) => p.roles.includes(session.role)).map((p) =>
        <Link key={p.href} href={p.href} className={path.startsWith(p.href) ? "active" : ""} aria-current={path.startsWith(p.href) ? "page" : undefined}>{p.label}</Link>)}</nav>}
      <div className="netrix-top-actions">
        <div className="lang-switch" role="group" aria-label="Language"><button type="button" aria-pressed={lang === "en"} className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button><span aria-hidden="true">|</span><button type="button" lang="kn" aria-pressed={lang === "kn"} className={lang === "kn" ? "active" : ""} onClick={() => setLang("kn")}>ಕನ್ನಡ</button></div>
        <span className={`netrix-server ${serverOk === false ? "down" : serverOk ? "up" : ""}`}>{serverOk === undefined ? "Checking model" : serverOk ? "Model connected" : "Server offline"}</span>
        {session && <span className="netrix-user"><strong>{session.display}</strong><small>{session.role_name}</small></span>}
        {session && <button type="button" className="netrix-logout" onClick={async () => { await logout(); router.replace("/login"); }}><LogOut size={14} /> Log out</button>}
      </div>
    </header>
    {session === undefined ? <div className="netrix-wait" role="status">Checking your login…</div>
      : !session ? <div className="netrix-wait" role="status">Taking you to the login page…</div>
      : !allowed ? <div className="netrix-denied" role="alert"><ShieldAlert size={22} /><h2>{session.role_name} logins can’t open this page.</h2><p>{page?.label} is for {page?.roles.map((r) => ({ operator: "Operators", inspector: "QC Inspectors", supervisor: "Supervisors" })[r]).join(", ")}.</p><Link href="/inspect" className="button-primary">Go to Inspect</Link></div>
      : children}
  </div>;
}

export function PageIntro({ title, text }: { title: string; text: string }) {
  return <div className="netrix-intro"><h1>{title}</h1><p>{text}</p></div>;
}
