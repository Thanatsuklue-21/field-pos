const PREFIX="field-operator-coach-v3";

export function operatorCoachSeenKey({operatorId,mode}={}){
  const id=String(operatorId||"").trim();
  const screen=mode==="queue"?"queue":"pos";
  return id?PREFIX+":"+encodeURIComponent(id)+":"+screen:"";
}

export function shouldAutoOpenOperatorCoach({seenKey="",seenValue=null,busy=false,hasGuide=false}={}){
  return Boolean(hasGuide&&!busy&&seenKey&&seenValue!=="seen");
}
