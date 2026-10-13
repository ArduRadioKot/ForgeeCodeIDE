const root=document.documentElement;
const REPO='ArduRadioKot/ForgeeCodeIDE';
try{const t=localStorage.getItem('theme');if(t)root.dataset.theme=t}catch(e){}
document.getElementById('theme').onclick=()=>{
  const light=root.dataset.theme?root.dataset.theme==='light':matchMedia('(prefers-color-scheme:light)').matches;
  root.dataset.theme=light?'dark':'light';try{localStorage.setItem('theme',root.dataset.theme)}catch(e){}};

// шапка становится стеклянной после начала прокрутки, мобильное меню (как у S.I.T Education)
const header=document.querySelector('[data-header]');
const onScroll=()=>header.classList.toggle('is-scrolled',scrollY>12);
onScroll();addEventListener('scroll',onScroll,{passive:true});
const menuButton=document.querySelector('[data-menu-toggle]'),menu=document.querySelector('[data-mobile-menu]');
function setMenu(open){
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
  menu.classList.toggle('is-open',open);menu.setAttribute('aria-hidden',String(!open));
  menu.inert=!open;document.body.classList.toggle('menu-open',open);
}
menu.inert=true;
menuButton.addEventListener('click',()=>setMenu(menuButton.getAttribute('aria-expanded')!=='true'));
menu.addEventListener('click',e=>{if(e.target.closest('a'))setMenu(false)});
addEventListener('resize',()=>{if(innerWidth>1140)setMenu(false)});

// вкладки обзора с линзой
const seg=document.querySelector('.seg'),lens=seg.querySelector('.lens');
const tabs=[...seg.querySelectorAll('[role=tab]')],panels=[...document.querySelectorAll('.panel')];
const moveLens=()=>{const t=tabs.find(x=>x.getAttribute('aria-selected')==='true');
  lens.style.width=t.offsetWidth+'px';lens.style.height=t.offsetHeight+'px';lens.style.transform=`translate(${t.offsetLeft}px,${t.offsetTop}px)`};
tabs.forEach((t,i)=>t.addEventListener('click',()=>{
  tabs.forEach((x,j)=>x.setAttribute('aria-selected',String(i===j)));
  panels.forEach((p,j)=>{p.hidden=i!==j});moveLens()}));
moveLens();addEventListener('resize',moveLens);document.fonts?.ready.then(moveLens);

// платформа посетителя и ссылки на последний релиз GitHub
const ua=navigator.userAgent,os=/Mac/.test(ua)?'mac':/Win/.test(ua)?'win':/Linux|X11/.test(ua)?'linux':'';
const names={mac:'macOS',win:'Windows',linux:'Linux'};
const releases=`https://github.com/${REPO}/releases`;
const dlMain=document.getElementById('dl-main');
if(os){document.getElementById('dl-label').textContent='Скачать для '+names[os];
  document.getElementById('dl-os').setAttribute('href','#i-'+os);}

const pick={
  mac:[/arm64.*\.dmg$/i,/\.dmg$/i,/mac.*\.zip$/i],
  win:[/setup.*\.exe$/i,/\.exe$/i,/win.*\.zip$/i],
  linux:[/\.AppImage$/i,/\.deb$/i]
};
fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then(r=>r.ok?r.json():Promise.reject()).then(rel=>{
  const assets=rel.assets||[];
  document.getElementById('dl-ver').textContent=`Бесплатно. Версия ${String(rel.tag_name||'').replace(/^v/,'')}, сборки лежат на странице релизов GitHub.`;
  for(const k of Object.keys(pick)){
    const a=pick[k].map(re=>assets.find(x=>re.test(x.name))).find(Boolean);
    const link=document.querySelector(`.dl[data-os=${k}] .btn`);
    if(a&&link){link.href=a.browser_download_url;link.removeAttribute('target')}
    if(a&&k===os){dlMain.href=a.browser_download_url;dlMain.removeAttribute('target')}
  }
}).catch(()=>{});

document.querySelectorAll('[data-year]').forEach(e=>{e.textContent=new Date().getFullYear()});
