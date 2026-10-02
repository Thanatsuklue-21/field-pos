export type AvailabilityVariant={
  label:string;
  available:boolean;
  maxServings:number;
  lowStock:boolean;
  recipeItems:Record<string,number>;
  missingIngredients?:{id:string;name:string}[];
  reason?:string|null;
};

export type AvailabilityMenu={id:string;variants:AvailabilityVariant[]};
export type AvailabilityStock=Record<string,{qty:number;name:string}>;
export type AvailabilityCartItem={id:string;variant:string;qty:number};

export function cartAvailability(input:{
  cart:AvailabilityCartItem[];
  menu:AvailabilityMenu[];
  stock:AvailabilityStock;
}):{
  available:boolean;
  demand:Record<string,number>;
  invalid:{id:string;variant:string}[];
  shortages:{id:string;name:string;required:number;available:number}[];
};

export function additionalServingsAvailable(input:{
  cart:AvailabilityCartItem[];
  menu:AvailabilityMenu[];
  stock:AvailabilityStock;
  menuId:string;
  variantLabel:string;
}):number;
