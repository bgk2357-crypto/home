import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Argo&Health Lab | 안전과 건강을 잇는 파트너", template: "%s | Argo&Health Lab" },
  description: "Argo&Health Lab의 회사소개, 안전보건 사업 안내, 자료실, 회원 Q&A와 비회원 방명록입니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased"><a className="skip-link" href="#main-content">본문으로 바로가기</a>{children}</body>
    </html>
  );
}
