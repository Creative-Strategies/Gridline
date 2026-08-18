import dynamic from "next/dynamic";

const GridlineViewer = dynamic(
  () => import("@gridline/react").then((module) => module.GridlineViewer),
  { ssr: false },
);

export default function Home() {
  return (
    <main>
      <GridlineViewer className="demo-viewer" />
    </main>
  );
}

