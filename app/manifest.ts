import type {MetadataRoute} from "next";

export default function manifest():MetadataRoute.Manifest{
  return {
    name:"FIELD POS",
    short_name:"FIELD",
    description:"FIELD Drink Shop Management System",
    start_url:"/pos",
    scope:"/",
    display:"standalone",
    orientation:"any",
    background_color:"#f6f7f8",
    theme_color:"#f6f7f8",
    lang:"th",
    categories:["business","productivity"],
    icons:[
      {src:"/field-pos-icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"},
      {src:"/field-pos-icon-maskable.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}
    ]
  };
}
