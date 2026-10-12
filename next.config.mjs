// Keep PWA release identity fresh for both direct Next hosting and Vercel.
export default {
  async headers(){
    return [
      {source:"/sw.js",headers:[
        {key:"Cache-Control",value:"no-cache, no-store, must-revalidate"},
        {key:"Service-Worker-Allowed",value:"/"},
      ]},
      {source:"/manifest.webmanifest",headers:[
        {key:"Cache-Control",value:"public, max-age=0, must-revalidate"},
      ]},
    ];
  },
};
