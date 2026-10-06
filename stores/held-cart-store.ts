"use client";
import {create} from "zustand";
import {persist} from "zustand/middleware";
import type {CartItem} from "@/stores/cart-store";

export type HeldCart={
  id:string;
  createdAt:number;
  items:CartItem[];
};

type HeldCartState={
  held:HeldCart[];
  holdCart:(items:CartItem[])=>HeldCart;
  removeHeld:(id:string)=>void;
  clearHeld:()=>void;
};

function newId(){
  if(typeof crypto!=="undefined"&&typeof crypto.randomUUID==="function")return crypto.randomUUID();
  return "hold-"+Date.now()+"-"+Math.random().toString(36).slice(2);
}

export const useHeldCartStore=create<HeldCartState>()(persist((set,get)=>({
  held:[],
  holdCart:items=>{
    const hold:HeldCart={id:newId(),createdAt:Date.now(),items:items.map(x=>({...x}))};
    set({held:[hold,...get().held]});
    return hold;
  },
  removeHeld:id=>set(s=>({held:s.held.filter(x=>x.id!==id)})),
  clearHeld:()=>set({held:[]})
}),{name:"field-pos-held-carts-v1",partialize:s=>({held:s.held}) as HeldCartState}));
