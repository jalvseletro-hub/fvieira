import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "F.VIEIRA — Gestão de Frota" },
      { name: "description", content: "Sistema de gestão de fretes e custos para frotas de caminhões." },
      { property: "og:title", content: "F.VIEIRA — Gestão de Frota" },
      { property: "og:description", content: "Gestão de fretes, custos e relatórios para sua frota." },
    ],
  }),
  component: IndexPage,
  ssr: false,
});

function IndexPage() {
  const [App, setApp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    import("@/App").then((m) => setApp(() => m.default));
  }, []);

  if (!App) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <div className="text-white flex flex-col items-center gap-4">
          <RefreshCw className="animate-spin text-indigo-500" size={40} />
          <p className="text-slate-400">Carregando sistema...</p>
        </div>
      </div>
    );
  }
  return <App />;
}
