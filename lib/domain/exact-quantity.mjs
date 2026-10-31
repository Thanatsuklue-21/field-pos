// Rational decimal arithmetic is shared by stock demand and actual FIFO costs.
// Number conversion happens only when serializing legacy JSON/API fields.
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b]}return a||1n};
export function rational(n,d=1n){if(d===0n)throw new Error('zero_denominator');if(d<0n){n=-n;d=-d}const g=gcd(n,d);return {n:n/g,d:d/g}}
export function exact(value){
  if(value&&typeof value.n==='bigint')return value;
  const text=String(value).trim(),m=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if(!m||text.length>200)throw new Error('invalid_quantity');
  const scale=(m[3]||'').length-Number(m[4]||0);if(Math.abs(scale)>100)throw new Error('invalid_quantity');
  const n=BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]||''));
  return scale<0?rational(n*10n**BigInt(-scale)):rational(n,10n**BigInt(scale));
}
export const add=(a,b)=>{a=exact(a);b=exact(b);return rational(a.n*b.d+b.n*a.d,a.d*b.d)};
export const sub=(a,b)=>{a=exact(a);b=exact(b);return rational(a.n*b.d-b.n*a.d,a.d*b.d)};
export const mul=(a,b)=>{a=exact(a);b=exact(b);return rational(a.n*b.n,a.d*b.d)};
export const div=(a,b)=>{a=exact(a);b=exact(b);return rational(a.n*b.d,a.d*b.n)};
export const cmp=(a,b)=>{const x=sub(a,b).n;return x<0n?-1:x>0n?1:0};
export function decimalString(value,places=24){
  const {n,d}=exact(value),sign=n<0n?'-':'',v=n<0n?-n:n;
  let text=String(v/d),rem=v%d;if(!rem)return sign+text;
  text+='.';for(let i=0;i<places&&rem;i++){rem*=10n;text+=String(rem/d);rem%=d}
  return sign+text;
}
export const serializeExact=value=>{const {n,d}=exact(value);return {numerator:String(n),denominator:String(d)}};
export const parseExact=value=>rational(BigInt(value.numerator),BigInt(value.denominator));
export function moneyNumber(value){
  const {n,d}=exact(value),sign=n<0n?-1n:1n,v=n*sign;
  const cents=sign*((v*200n+d)/(2n*d));
  if(cents>BigInt(Number.MAX_SAFE_INTEGER)||cents<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('money_overflow');
  return Number(decimalString(rational(cents,100n)));
}
