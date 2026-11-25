"use client";
import { PageIcon } from "@/components/page-icons";
import { Toaster } from "@/components/toaster";
import { motion } from "framer-motion";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { LogOut, ShieldAlert } from "lucide-react";
import { checkHealth, checkSessionState, logout, type Role, type Session } from "@/lib/api";
import { useLang } from "@/lib/voice";

export const PAGES: { href: string; label: string; roles: Role[] }[] = [
  { href: "/train", label: "Train", roles: ["operator", "inspector", "supervisor"] },
  { href: "/inspect", label: "Inspect", roles: ["operator", "inspector", "supervisor"] },
  { href: "/evaluation", label: "Evaluation", roles: ["inspector", "supervisor"] },
  { href: "/objects", label: "Object library", roles: ["operator", "inspector", "supervisor"] },
  { href: "/history", label: "History", roles: ["operator", "inspector", "supervisor"] },
  { href: "/summary", label: "Summary", roles: ["supervisor"] },
];

export function BrandMark({ small = false, href = "/" }: { small?: boolean; href?: string }) {
  return <Link href={href} className={`netrix-brand ${small ? "small" : ""}`} aria-label={href === "/" ? "Netrix IQ home" : "Netrix IQ: go to Inspect"}>
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

  useEffect(() => {  // on every page, when the window comes back into focus, and once a minute
    let gone = false;
    const check = () => checkSessionState().then(({ session: s, expired }) => {
      if (gone) return;
      setSession(s);
      // replace, not push: Back must never bounce between /login and a protected page
      if (!s) router.replace(`/login?next=${encodeURIComponent(path)}${expired ? "&expired=1" : ""}`);
    });
    check();
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { gone = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [path, router]);

  const page = PAGES.find((p) => path.startsWith(p.href));
  const allowed = session && (!page || page.roles.includes(session.role));

  return <div className="netrix-app">
    <Toaster />
    <header className="netrix-topbar">
      <BrandMark small href={session ? "/inspect" : "/"} />
      {session && <nav aria-label="Pages">{PAGES.filter((p) => p.roles.includes(session.role)).map((p) =>
        <Link key={p.href} href={p.href} className={path.startsWith(p.href) ? "active" : ""} aria-current={path.startsWith(p.href) ? "page" : undefined}>{path.startsWith(p.href) && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}<span>{p.label}</span></Link>)}</nav>}
      <div className="netrix-top-actions">
        <div className="lang-switch" role="group" aria-label="Language"><button type="button" aria-pressed={lang === "en"} className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>{lang === "en" && <motion.span layoutId="lang-pill" className="seg-pill" />}<span>EN</span></button><span aria-hidden="true">|</span><button type="button" lang="kn" aria-pressed={lang === "kn"} className={lang === "kn" ? "active" : ""} onClick={() => setLang("kn")}>{lang === "kn" && <motion.span layoutId="lang-pill" className="seg-pill" />}<span>ಕನ್ನಡ</span></button></div>
        <span className={`netrix-server ${serverOk === false ? "down" : serverOk ? "up" : ""}`}>{serverOk === undefined ? "Checking model" : serverOk ? "Model connected" : "Server offline"}</span>
        {session && <span className="netrix-user"><strong>{session.display}</strong><small>{session.role_name}</small></span>}
        {session && <button type="button" className="netrix-logout" onClick={async () => { await logout(); router.replace("/"); }}><LogOut size={14} /> Log out</button>}
      </div>
    </header>
    {session === undefined ? <div className="netrix-wait" role="status">Checking your login…</div>
      : !session ? <div className="netrix-wait" role="status">Taking you to the login page…</div>
      : !allowed ? <div className="netrix-denied" role="alert"><ShieldAlert size={22} /><h2>{session.role_name} logins can’t open this page.</h2><p>{page?.label} is for {page?.roles.map((r) => ({ operator: "Operators", inspector: "QC Inspectors", supervisor: "Supervisors" })[r]).join(", ")}.</p><Link href="/inspect" className="button-primary">Go to Inspect</Link></div>
      : <div key={path} className="netrix-page">{children}</div>}
  </div>;
}

export function PageIntro({ title, text }: { title: string; text: string }) {
  return <div className="netrix-intro"><PageIcon name={title} /><div><h1>{title}</h1><p>{text}</p></div></div>;
}
