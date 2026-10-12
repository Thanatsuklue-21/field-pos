export const FRONT_COUNTER_ROUTES=["/pos","/dashboard","/close"] as const;
export const OPERATION_ROUTES=["/queue","/orders","/stock","/expenses"] as const;
export const MANAGEMENT_ROUTES=["/products","/costs","/customers","/recipes","/reports","/backup","/users","/audit","/settings"] as const;

export function splitNavigation<T extends readonly [string,...unknown[]]>(allowed:readonly T[]){
  const by=(routes:readonly string[])=>allowed.filter(([href])=>routes.includes(String(href)));
  const known=new Set([...FRONT_COUNTER_ROUTES,...OPERATION_ROUTES,...MANAGEMENT_ROUTES]);
  return {
    front:by(FRONT_COUNTER_ROUTES),
    operations:by(OPERATION_ROUTES),
    management:[...by(MANAGEMENT_ROUTES),...allowed.filter(([href])=>!known.has(String(href) as any))]
  };
}
