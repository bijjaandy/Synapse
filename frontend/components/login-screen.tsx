"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ClipboardCheck, Factory, LineChart, LoaderCircle, LogIn } from "lucide-react";
import { login, type Role } from "@/lib/api";
import { BrandMark } from "@/components/netrix-shell";

const ROLES: { role: Role; title: string; who: string; problem: string; does: string[]; icon: React.ReactNode; demo: [string, string] }[] = [
  { role: "operator", title: "Line Operator", icon: <Factory size={20} />, demo: ["operator", "operator123"],
    who: "The person at the station, putting parts under the camera.",
    problem: "Checking every part by eye is slow and tiring, and small defects slip through late in a shift.",
    does: ["Teaches a new part from 20 good photos", "Inspects with a photo or the webcam", "Marks a false alarm good in one click"] },
  { role: "inspector", title: "QC Inspector", icon: <ClipboardCheck size={20} />, demo: ["inspector", "inspector123"],
    who: "Quality control, who makes the final call on doubtful parts.",
    problem: "Wasted time re-checking every part, and no record of why a part was rejected.",
    does: ["Verifies unsure and defective parts", "Tests a part on labelled folders", "Asks the local AI about results"] },
  { role: "supervisor", title: "Shift Supervisor", icon: <LineChart size={20} />, demo: ["supervisor", "supervisor123"],
    who: "Owns the line’s quality numbers for the shift.",
    problem: "No clear picture of defect rates per part, or of how often people overrule the machine.",
    does: ["Sees everything the others do", "Reads the summary: totals, parts, speed", "Prints the shift report"] },
];

export default function LoginScreen() {
  const router = useRouter();
  const next = useSearchParams()?.get("next") ?? "/inspect";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion() ?? false;

  async function submit(e?: React.FormEvent, creds?: [string, string]) {
    e?.preventDefault();
    const [u, p] = creds ?? [username, password];
    if (!u || !p) { setError("Enter a username and password."); return; }
    setBusy(true);
    setError(null);
    try {
      await login(u, p);
      router.replace(next.startsWith("/") ? next : "/inspect");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return <main className="netrix-login">
    <section className="login-who">
      <BrandMark />
      <h1>Who uses Netrix IQ</h1>
      <p className="login-lede">Factories make thousands of good parts for every bad one, so there are no defect photos to train on. Netrix IQ learns only from good parts and runs on the laptop at the line, with no internet. Three people use it:</p>
      <div className="login-roles">{ROLES.map((r, i) =>
        <motion.article key={r.role} className="login-role" initial={reducedMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : 0.08 * i }}>
          <div className="login-role-head"><span className="login-role-icon">{r.icon}</span><h2>{r.title}</h2></div>
          <p className="login-role-who">{r.who}</p>
          <p className="login-role-problem"><b>Problem:</b> {r.problem}</p>
          <ul>{r.does.map((d) => <li key={d}>{d}</li>)}</ul>
          <button type="button" className="login-demo" disabled={busy} onClick={() => { setUsername(r.demo[0]); setPassword(r.demo[1]); submit(undefined, r.demo); }}>Sign in as {r.title}</button>
        </motion.article>)}</div>
    </section>
    <section className="login-form-wrap">
      <form className="login-form" onSubmit={submit}>
        <h2>Sign in</h2>
        <p>Accounts are stored on this laptop. Demo logins: operator / operator123, inspector / inspector123, supervisor / supervisor123.</p>
        <label htmlFor="login-user">Username</label>
        <input id="login-user" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="login-pass">Password</label>
        <input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="netrix-error" role="alert">{error}</p>}
        <button type="submit" className="button-primary login-submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />} Sign in</button>
      </form>
    </section>
  </main>;
}
