"use client";

export type DeviceUatDiagnostics={
  viewportWidth:number;
  viewportHeight:number;
  visualViewportSupported:boolean;
  visualViewportWidth:number|null;
  visualViewportHeight:number|null;
  touchCapable:boolean;
  orientation:"portrait"|"landscape";
  targetClass:"phone"|"tablet"|"other";
};

export function readDeviceUatDiagnostics():DeviceUatDiagnostics{
  if(typeof window==="undefined"){
    return {viewportWidth:0,viewportHeight:0,visualViewportSupported:false,visualViewportWidth:null,visualViewportHeight:null,touchCapable:false,orientation:"portrait",targetClass:"other"};
  }
  const width=Math.max(0,Math.round(window.innerWidth||0));
  const height=Math.max(0,Math.round(window.innerHeight||0));
  const vv=window.visualViewport;
  const orientation=width>height?"landscape":"portrait";
  const shortest=Math.min(width,height),longest=Math.max(width,height);
  const targetClass=shortest>=768&&shortest<=1024?"tablet":shortest>=320&&shortest<=430&&longest>=568?"phone":"other";
  return {
    viewportWidth:width,
    viewportHeight:height,
    visualViewportSupported:!!vv,
    visualViewportWidth:vv?Math.max(0,Math.round(vv.width)):null,
    visualViewportHeight:vv?Math.max(0,Math.round(vv.height)):null,
    touchCapable:Number(navigator.maxTouchPoints||0)>0||"ontouchstart" in window,
    orientation,
    targetClass
  };
}
