"use client";

import {useEffect,useRef} from "react";

const FOCUSABLE='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function ModalFocus({
  children,
  className="",
  labelId,
  onEscape,
  initialFocusSelector
}:{
  children:React.ReactNode;
  className?:string;
  labelId?:string;
  onEscape?:()=>void;
  initialFocusSelector?:string;
}){
  const ref=useRef<HTMLDivElement>(null);
  const escapeRef=useRef(onEscape);
  escapeRef.current=onEscape;

  useEffect(()=>{
    const node=ref.current;
    if(!node)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const focusables=()=>Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el=>!el.hasAttribute("disabled")&&el.tabIndex!==-1);
    const preferred=initialFocusSelector?node.querySelector<HTMLElement>(initialFocusSelector):null;
    const first=preferred||focusables()[0]||node;
    queueMicrotask(()=>first.focus({preventScroll:true}));

    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&escapeRef.current){
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if(event.key!=="Tab")return;
      const items=focusables();
      if(items.length===0){
        event.preventDefault();
        node.focus({preventScroll:true});
        return;
      }
      const firstItem=items[0],lastItem=items[items.length-1];
      if(event.shiftKey&&document.activeElement===firstItem){
        event.preventDefault();
        lastItem.focus();
      }else if(!event.shiftKey&&document.activeElement===lastItem){
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown",onKeyDown);
    return()=>{
      document.removeEventListener("keydown",onKeyDown);
      if(previous&&document.contains(previous))queueMicrotask(()=>previous.focus({preventScroll:true}));
    };
  },[initialFocusSelector]);

  return <div
    ref={ref}
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelId}
    tabIndex={-1}
    className={className}
  >{children}</div>;
}
