"use client";
import {create} from "zustand";
export type CartItem={key:string;id:string;name:string;variant:string;price:number;qty:number};
type S={items:CartItem[];addItem:(x:Omit<CartItem,"qty"|"key">)=>void;removeItem:(key:string)=>void;updateQuantity:(key:string,qty:number)=>void;clearCart:()=>void;getSubtotal:()=>number;getTax:()=>number;getTotal:()=>number};
export const useCartStore=create<S>((set,get)=>({
items:[],
addItem:x=>set(s=>{const key=x.id+"::"+x.variant,found=s.items.find(i=>i.key===key);return{items:found?s.items.map(i=>i.key===key?{...i,qty:i.qty+1}:i):[...s.items,{...x,key,qty:1}]}}),
removeItem:key=>set(s=>({items:s.items.filter(i=>i.key!==key)})),
updateQuantity:(key,qty)=>set(s=>({items:qty<=0?s.items.filter(i=>i.key!==key):s.items.map(i=>i.key===key?{...i,qty}:i)})),
clearCart:()=>set({items:[]}),getSubtotal:()=>get().items.reduce((s,i)=>s+i.price*i.qty,0),getTax:()=>0,getTotal:()=>get().getSubtotal()
}));