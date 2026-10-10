import type {MetadataRoute} from "next";
export default function manifest():MetadataRoute.Manifest{return {
  id:"/pos",name:"FIELD POS",short_name:"FIELD",description:"FIELD Café point of sale",
  start_url:"/pos",scope:"/",display:"standalone",orientation:"portrait-primary",
  background_color:"#F7F1E3",theme_color:"#1F4D3A",prefer_related_applications:false,
  icons:[
    {src:"/field-icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
    {src:"/field-icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
    {src:"/field-icon-192.png",sizes:"192x192",type:"image/png",purpose:"maskable"},
    {src:"/field-icon-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"}
  ]
};}
