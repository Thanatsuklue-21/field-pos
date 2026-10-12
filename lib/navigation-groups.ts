export const FRONT_COUNTER_ROUTES=["/pos"] as const;
export const OPERATION_ROUTES=["/dashboard","/queue","/orders","/stock","/expenses","/close"] as const;
export const MANAGEMENT_ROUTES=["/products","/costs","/customers","/recipes","/reports","/backup","/users","/audit","/settings"] as const;

export function splitNavigation<T extends readonly [string,...unknown[]]>(allowed:readonly T[]){
  const by=(routes:readonly string[])=>routes.flatMap(route=>allowed.filter(([href])=>String(href)===route));
  const known=new Set([...FRONT_COUNTER_ROUTES,...OPERATION_ROUTES,...MANAGEMENT_ROUTES]);
  return {
    front:by(FRONT_COUNTER_ROUTES),
    operations:by(OPERATION_ROUTES),
    management:[...by(MANAGEMENT_ROUTES),...allowed.filter(([href])=>!known.has(String(href) as any))]
  };
}
