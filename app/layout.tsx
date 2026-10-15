import type {Metadata,Viewport} from "next";
import "./globals.css";
import AppShell from "@/components/app-shell";
import PwaRegister from "@/components/pwa-register";

export const metadata:Metadata={
  title:"FIELD POS",
  description:"FIELD Drink Shop Management System",
  applicationName:"FIELD POS",
  appleWebApp:{capable:true,title:"FIELD POS",statusBarStyle:"default"}
};

export const viewport:Viewport={
  width:"device-width",
  initialScale:1,
  viewportFit:"cover",
  themeColor:"#f6f7f8"
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="th"><body><PwaRegister/><AppShell>{children}</AppShell></body></html>;
}
