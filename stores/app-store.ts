"use client";
import {create} from "zustand"; import {persist} from "zustand/middleware"; import type {Lang} from "@/lib/i18n";
type S={language:Lang;notifications:boolean;setLanguage:(v:Lang)=>void;setNotifications:(v:boolean)=>void};
export const useAppStore=create<S>()(persist((set)=>({language:"TH",notifications:true,setLanguage:v=>set({language:v}),setNotifications:v=>set({notifications:v})}),{name:"field-app"}));