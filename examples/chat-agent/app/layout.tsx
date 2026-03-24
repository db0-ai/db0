import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "db0 Chat Agent",
  description: "A chatbot with persistent memory powered by db0",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <style>{`
          body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
          .markdown p { margin: 0.4em 0; }
          .markdown p:first-child { margin-top: 0; }
          .markdown p:last-child { margin-bottom: 0; }
          .markdown ul, .markdown ol { margin: 0.4em 0; padding-left: 1.5em; }
          .markdown li { margin: 0.2em 0; }
          .markdown strong { font-weight: 600; }
          .markdown code { background: rgba(0,0,0,0.06); padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.85em; }
          .markdown pre { background: rgba(0,0,0,0.06); padding: 0.6em; border-radius: 6px; overflow-x: auto; }
          .markdown pre code { background: none; padding: 0; }
          .markdown h1, .markdown h2, .markdown h3 { margin: 0.5em 0 0.3em; }
          .markdown blockquote { margin: 0.4em 0; padding-left: 0.75em; border-left: 3px solid #ddd; color: #666; }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
