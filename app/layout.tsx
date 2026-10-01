import type {Metadata} from "next"; import "./globals.css"; import AppShell from "@/components/app-shell";
export const metadata:Metadata={title:"FIELD POS",description:"FIELD Drink Shop Management System"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body><AppShell>{children}</AppShell></body></html>}