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
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
