const ALLOWED=new Set(['image/jpeg','image/png','image/webp']);
const MAX_BYTES=180_000;
const bad=code=>Object.assign(new Error(code),{status:400});

export function normalizeMenuImageUpload({dataUrl}={}){
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl||''));
  if(!match||!ALLOWED.has(match[1]))throw bad('invalid_menu_image');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length)throw bad('invalid_menu_image');
  if(bytes.length>MAX_BYTES)throw bad('menu_image_too_large');
  return {mimeType:match[1],bytes,dataUrl:`data:${match[1]};base64,${bytes.toString('base64')}`};
}
