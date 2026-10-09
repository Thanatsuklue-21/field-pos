const PRIMARY=["/pos","/queue","/orders","/stock"];
const PRIORITY=["/expenses","/close","/settings"];

// Input is already permission-filtered; never invent destinations for an operator.
export function mobileOverflow<T extends readonly [string,...unknown[]]>(allowed:readonly T[]):T[]{
  const rank=(href:string)=>{const index=PRIORITY.indexOf(href);return index<0?PRIORITY.length:index};
  return allowed.filter(([href])=>!PRIMARY.includes(href)).sort((a,b)=>rank(a[0])-rank(b[0]));
}
