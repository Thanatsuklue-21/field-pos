const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'});
export function bangkokDate(now=Date.now()){return formatter.format(new Date(now))}
