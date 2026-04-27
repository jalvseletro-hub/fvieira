import { createFileRoute } from "@tanstack/react-router";
import App from "@/App";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "F.VIEIRA — Gestão de Frota" },
      { name: "description", content: "Sistema de gestão de fretes e custos para frotas de caminhões." },
      { property: "og:title", content: "F.VIEIRA — Gestão de Frota" },
      { property: "og:description", content: "Gestão de fretes, custos e relatórios para sua frota." },
    ],
  }),
  component: App,
});
