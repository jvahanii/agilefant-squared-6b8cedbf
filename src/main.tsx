import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { ClerkBridge } from "./lib/clerkBridge";
import App from "./App.tsx";
import "./index.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

// Rendered without Clerk when no key is configured, rather than letting
// ClerkProvider throw and take the whole app down with it. During the migration
// that is the difference between an environment that is merely still on
// Supabase Auth and one that is broken — and the production build only gets the
// key if it is set wherever the site is built, which is outside this repo.
const app = clerkPublishableKey
  ? (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ClerkBridge />
      <App />
    </ClerkProvider>
  )
  : <App />;

if (!clerkPublishableKey && import.meta.env.PROD) {
  console.warn(
    'VITE_CLERK_PUBLISHABLE_KEY is not set — signing in will use Supabase Auth. ' +
    'Set it wherever this site is built to enable Clerk.',
  );
}

createRoot(document.getElementById("root")!).render(app);
