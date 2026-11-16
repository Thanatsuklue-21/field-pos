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

// Next.js 16 + Tailwind 4 need Chrome 111+ (Android 7+ with an updated Chrome).
// Older WebViews would otherwise show a blank or broken screen; tell the
// operator exactly what to do instead. Plain ES5 so it runs on any browser.
const LEGACY_BROWSER_GUARD=`(function(){try{var ok=window.CSS&&CSS.supports&&CSS.supports("color","color-mix(in srgb, red, blue)");if(ok)return;}catch(e){}
document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.style.cssText="position:fixed;inset:0;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#fff;overflow:auto";d.innerHTML='<div id="field-legacy-browser" role="alert" style="font-family:sans-serif;padding:24px;max-width:520px;margin:40px auto;line-height:1.6;color:#1d1d1f"><h1 style="font-size:22px;color:#1f4d3a">FIELD POS เปิดในเบราว์เซอร์นี้ไม่ได้</h1><p>กรุณาอัปเดต <b>Google Chrome</b> จาก Play Store แล้วเปิดใหม่</p><p style="color:#475569;font-size:14px">ต้องใช้ Android 7 ขึ้นไป และ Chrome เวอร์ชัน 111 ขึ้นไป · ยังไม่มีการขายหรือบันทึกข้อมูลใดๆ จากหน้านี้</p></div>';document.documentElement.appendChild(d);});})();`;

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="th"><head><script dangerouslySetInnerHTML={{__html:LEGACY_BROWSER_GUARD}}/></head><body><PwaRegister/><AppShell>{children}</AppShell></body></html>;
}
