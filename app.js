const socket = io();
const $ = id => document.getElementById(id);
const lobby = $('lobby'), app = $('app'), canvas = $('canvas'), ctx = canvas.getContext('2d');
let room = '', tool = 'pen', color = '#292b36', size = 5, strokes = [], current = null;
let scale = 1, panX = 0, panY = 0, pointers = new Map(), lastPoints = [], imgBg = null, gesture = null;

const colors = ['#292b36','#ffffff','#ff4d5e','#ff8a3d','#ffd43b','#39c978','#21c9bd','#3287ff','#5b63e8','#a94ee8','#f34ca5','#8e5a3c','#9295a3','#a7d8ff','#ffc0cb','#b8e986'];
$('palette').innerHTML = colors.map(c => `<button class="swatch${c===color?' selected':''}" style="background:${c}" data-color="${c}" aria-label="Cor ${c}"></button>`).join('');

function resizeCanvas(){
  const r = $('viewport').getBoundingClientRect();
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
  canvas.width = Math.round(r.width*dpr);
  canvas.height = Math.round(r.height*dpr);
  canvas.style.width = r.width+'px';
  canvas.style.height = r.height+'px';
  draw();
}
window.addEventListener('resize', resizeCanvas);
if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe($('viewport'));

function draw(){
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*panX,dpr*panY);
  if(imgBg) ctx.drawImage(imgBg,0,0);
  for(const s of strokes) renderStroke(s);
}
function renderStroke(s){
  if(!s.points?.length) return;
  ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';
  ctx.globalAlpha=1;
  ctx.strokeStyle=s.color; ctx.fillStyle=s.color; ctx.lineWidth=s.size;
  if(s.points.length===1){const p=s.points[0];ctx.beginPath();ctx.arc(p.x,p.y,s.size/2,0,Math.PI*2);ctx.fill();}
  else{ctx.beginPath();ctx.moveTo(s.points[0].x,s.points[0].y);for(const p of s.points.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}
function pos(e){
  const r=canvas.getBoundingClientRect();
  return {x:(e.clientX-r.left-panX)/scale,y:(e.clientY-r.top-panY)/scale};
}
function newId(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}
function pointDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function midpoint(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
function beginGesture(){
  current=null; lastPoints=[];
  const ps=[...pointers.values()];
  if(ps.length>=2){
    const mid=midpoint(ps[0],ps[1]), dist=pointDistance(ps[0],ps[1]);
    const rect=canvas.getBoundingClientRect();
    gesture={distance:Math.max(1,dist),scale,mid,world:{x:(mid.x-rect.left-panX)/scale,y:(mid.y-rect.top-panY)/scale}};
  }
}
canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size>=2){beginGesture();return;}
  if(pointers.size!==1)return;
  const p=pos(e);
  current={id:newId(),color,size,tool,points:[p]};
  strokes.push(current);
  socket.emit('stroke-start',{id:current.id,color,size,tool,point:p});
  draw();
});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  e.preventDefault();
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size>=2){
    const ps=[...pointers.values()];
    if(!gesture)beginGesture();
    if(gesture){
      const mid=midpoint(ps[0],ps[1]), dist=pointDistance(ps[0],ps[1]);
      const rect=canvas.getBoundingClientRect();
      scale=Math.max(.35,Math.min(5,gesture.scale*(dist/gesture.distance)));
      panX=mid.x-rect.left-gesture.world.x*scale;
      panY=mid.y-rect.top-gesture.world.y*scale;
      draw();
    }
    return;
  }
  if(!current)return;
  const p=pos(e);current.points.push(p);lastPoints.push(p);
  if(lastPoints.length>=4){socket.emit('stroke-points',{id:current.id,points:lastPoints});lastPoints=[];}
  draw();
});
function finishStroke(){
  if(!current)return;
  if(lastPoints.length)socket.emit('stroke-points',{id:current.id,points:lastPoints});
  lastPoints=[];
  socket.emit('stroke-end',current.id);
  current=null;
}
function endPointer(e){
  if(pointers.has(e.pointerId))pointers.delete(e.pointerId);
  if(pointers.size<2)gesture=null;
  if(pointers.size===0)finishStroke();
  else if(pointers.size===1){current=null;lastPoints=[];}
}
canvas.addEventListener('pointerup',endPointer);
canvas.addEventListener('pointercancel',endPointer);
canvas.addEventListener('lostpointercapture',endPointer);

$('create').onclick=()=>{
  $('msg').textContent='';
  $('create').disabled=true;$('create').textContent='Criando…';
  socket.emit('create-room',$('nickname').value,(r)=>{ $('create').disabled=false;$('create').textContent='＋ Criar uma sala'; enter(r); });
};
$('join').onclick=()=>{
  $('msg').textContent='';
  const code=$('roomcode').value.trim().toUpperCase();
  if(!code){$('msg').textContent='Digite o código da sala.';return;}
  socket.emit('join-room',{code,name:$('nickname').value},enter);
};
$('roomcode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
function enter(r){
  if(!r?.ok){$('msg').textContent=r?.error||'Não foi possível entrar. Verifique o código.';return;}
  room=r.code;strokes=r.strokes||[];lobby.hidden=true;app.hidden=false;
  $('roombadge').textContent='Sala '+room;
  resizeCanvas();
}
socket.on('connect_error',()=>{$('msg').textContent='Sem conexão com o servidor. Atualize e tente novamente.';});
socket.on('stroke-start',s=>{strokes.push(s);draw();});
socket.on('stroke-points',({id,points})=>{const s=strokes.find(s=>s.id===id);if(s)s.points.push(...points);draw();});
socket.on('remove-stroke',id=>{strokes=strokes.filter(s=>s.id!==id);draw();});
socket.on('clear-canvas',()=>{strokes=[];imgBg=null;draw();});
socket.on('people',p=>{$('people').textContent='● '+p.length+'/5 · '+p.map(x=>x.name).join(', ');});

document.querySelectorAll('.tool').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll('.tool').forEach(x=>x.classList.toggle('active',x===b));});
$('color').oninput=e=>{color=e.target.value;document.querySelectorAll('.swatch').forEach(x=>x.classList.remove('selected'));};
document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{color=b.dataset.color;$('color').value=color;document.querySelectorAll('.swatch').forEach(x=>x.classList.toggle('selected',x===b));});
$('size').oninput=e=>{size=+e.target.value;$('sizeValue').textContent=size;};
$('undo').onclick=()=>socket.emit('undo');
$('clear').onclick=()=>{if(confirm('Limpar o desenho de todo mundo nesta sala?'))socket.emit('clear-canvas');};
$('zoomout').onclick=()=>{scale=Math.max(.35,scale/1.2);draw();};
$('zoomin').onclick=()=>{scale=Math.min(5,scale*1.2);draw();};
$('resetzoom').onclick=()=>{scale=1;panX=panY=0;draw();};
$('save').onclick=()=>{const a=document.createElement('a');a.download='desenho-drawtogether.png';a.href=canvas.toDataURL('image/png');a.click();};
$('copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(room);$('copy').textContent='Copiado!';}
  catch{$('copy').textContent=room;}
  setTimeout(()=>$('copy').textContent='Copiar código',1800);
};
$('exit').onclick=()=>location.reload();
$('image').onchange=e=>{
  const f=e.target.files?.[0];if(!f)return;
  const im=new Image();im.onload=()=>{imgBg=im;draw();};im.src=URL.createObjectURL(f);
};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
