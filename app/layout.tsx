import type {Metadata,Viewport} from "next";
import "./globals.css";import AppShell from "@/components/app-shell";import PwaRuntime from "@/components/pwa-runtime";
export const metadata:Metadata={title:"FIELD POS",description:"FIELD Drink Shop Management System",applicationName:"FIELD POS",manifest:"/manifest.webmanifest",icons:{icon:[{url:"/field-icon-192.png",sizes:"192x192",type:"image/png"},{url:"/field-icon-512.png",sizes:"512x512",type:"image/png"}],apple:[{url:"/field-icon-180.png",sizes:"180x180",type:"image/png"}]},appleWebApp:{capable:true,statusBarStyle:"default",title:"FIELD"},other:{"mobile-web-app-capable":"yes"}};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#1F4D3A"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body><PwaRuntime/><AppShell>{children}</AppShell></body></html>}
