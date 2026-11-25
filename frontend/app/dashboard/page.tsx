import { redirect } from "next/navigation";

/** Old link: the dashboard is now split into /train and /inspect. */
export default function DashboardPage() {
  redirect("/inspect");
}
