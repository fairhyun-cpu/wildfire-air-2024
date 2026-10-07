const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits = 1) => value == null ? '—' : Number(value).toLocaleString('ko-KR', {maximumFractionDigits:digits,minimumFractionDigits:digits});
const state = {events:[], filtered:[], selected:null, stationIndex:0, hour:0, map:null, markers:null, nearby:null, play:null};

function colorFor(event){return event.delta24 == null ? '#9aa9a5' : event.delta24 > 0 ? '#ee663f' : event.delta24 < 0 ? '#427f91' : '#9aa9a5'}
function timeText(event){const d=new Date(event.start);return `${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function currentRow(){return state.selected?.series?.[24+state.hour] || null}
function stationDelta(event, stationIndex){const k=1+stationIndex*2;const before=event.series.slice(0,24).map(x=>x[k]).filter(x=>x!=null);const after=event.series.slice(24,48).map(x=>x[k]).filter(x=>x!=null);if(before.length<12||after.length<12)return null;return after.reduce((a,b)=>a+b,0)/after.length-before.reduce((a,b)=>a+b,0)/before.length}

function setStats(){const e=state.events, comparable=e.filter(x=>x.delta24!=null), up=comparable.filter(x=>x.delta24>0).length, down=comparable.filter(x=>x.delta24<0).length, wind=e.filter(x=>x.windStation).length;
  $('introStats').innerHTML=`<div class="intro-stat"><b>${e.length}</b><span>선택 가능한 산불</span></div><div class="intro-stat"><b>${comparable.length}</b><span>전후 비교 가능</span></div><div class="intro-stat"><b>${wind}</b><span>50km 이내 AWS 연결</span></div><div class="intro-stat"><b class="orange">${up}</b><span>PM2.5 상승 사건</span></div>`;
  $('upCount').textContent=`${up} / ${comparable.length}`;
  $('takeawayText').textContent=`가장 가까운 도시대기 측정소 기준, 발생 후 24시간 PM2.5가 오른 산불은 ${up}건, 내려간 산불은 ${down}건입니다. 단순 전후 평균만으로는 산불이 공기를 바꾸었다고 말하기 어렵습니다. 지도에서 사건을 눌러 시간 흐름과 측정소의 거리를 함께 확인해 보세요.`;
  const regions=[...new Set(e.map(x=>x.sido))].sort((a,b)=>a.localeCompare(b,'ko'));$('region').innerHTML='<option value="">전국</option>'+regions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('month').innerHTML='<option value="">전체</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('');
}

function applyFilters(){const q=$('search').value.trim().toLowerCase(),region=$('region').value,month=$('month').value,sort=$('sort').value;
  state.filtered=state.events.filter(e=>(!region||e.sido===region)&&(!month||Number(e.start.slice(5,7))===Number(month))&&(!q||`${e.sido} ${e.county} ${e.village}`.toLowerCase().includes(q)));
  state.filtered.sort((a,b)=>sort==='area'?(b.areaHa??-1)-(a.areaHa??-1):sort==='pm'?(b.delta24??-999)-(a.delta24??-999):b.start.localeCompare(a.start));
  $('resultCount').textContent=`${state.filtered.length}건 목록 · ${state.filtered.filter(e=>e.delta24!=null).length}건 지도`;
  if(!state.filtered.some(e=>e.id===state.selected?.id)){state.selected=state.filtered.find(e=>e.delta24!=null)||state.filtered[0]||null;state.stationIndex=0;state.hour=0;$('hourSlider').value='0'}
  renderList();renderMap();renderDetail();window.transportUI?.renderAll(state);
}

function renderList(){const list=$('eventList');if(!state.filtered.length){list.innerHTML='<div class="event-empty">검색 결과가 없습니다. 지역 또는 검색어를 바꿔 보세요.</div>';return}
  list.innerHTML=state.filtered.map(e=>`<button class="event-item ${state.selected?.id===e.id?'active':''}" type="button" data-id="${e.id}" role="option" aria-selected="${state.selected?.id===e.id}"><span class="event-item-top"><strong>${esc(e.sido)} ${esc(e.county)}</strong><time>${timeText(e)}</time></span><span class="event-item-bottom"><span>피해 ${fmt(e.areaHa,2)} ha</span><span class="change ${e.delta24>0?'up':e.delta24<0?'down':''}">PM2.5 ${e.delta24==null?'비교 불가':`${e.delta24>0?'+':''}${fmt(e.delta24)} ㎍/㎥`}</span></span></button>`).join('');
  list.querySelectorAll('[data-id]').forEach(btn=>btn.addEventListener('click',()=>selectEvent(btn.dataset.id)));
}

function selectEvent(id, stationIndex=0){const found=state.events.find(e=>e.id===id);if(!found)return;state.selected=found;state.stationIndex=Math.max(0,Math.min(stationIndex,found.airStations.length-1));state.hour=0;$('hourSlider').value='0';stopPlay();renderList();renderMap();renderDetail();window.transportUI?.renderAll(state);const active=$('eventList').querySelector('.active');active?.scrollIntoView({block:'nearest',behavior:'smooth'})}
function selectStation(index){if(!state.selected||!state.selected.airStations[index])return;state.stationIndex=index;renderDetail();window.transportUI?.renderAll(state)}
window.selectEvent=selectEvent;
window.selectStation=selectStation;

function setupMap(){if(!window.L){$('map').hidden=true;$('mapFallback').hidden=false;return}
  state.map=L.map('map',{zoomControl:false,scrollWheelZoom:true}).setView([36.3,127.7],7);
  L.control.zoom({position:'topright'}).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'© OpenStreetMap contributors'}).addTo(state.map);
  state.markers=L.layerGroup().addTo(state.map);state.nearby=L.layerGroup().addTo(state.map);
}

function renderMap(){const selected=state.selected;if(state.map){state.markers.clearLayers();for(const event of state.filtered){if(event.lat==null||event.delta24==null)continue;const active=event.id===selected?.id;const marker=L.circleMarker([event.lat,event.lon],{radius:active?10:Math.max(4,Math.min(8,4+Math.sqrt(event.areaHa||0))),color:active?'#172a30':'#fff',weight:active?2.5:1.2,fillColor:colorFor(event),fillOpacity:active?1:.78});marker.bindTooltip(`${esc(event.sido)} ${esc(event.county)} · ${timeText(event)}<br>PM2.5 ${event.delta24>0?'+':''}${fmt(event.delta24)} ㎍/㎥`,{direction:'top'});marker.on('click',()=>selectEvent(event.id));marker.addTo(state.markers)}if(selected?.lat!=null&&selected.delta24!=null)state.map.flyTo([selected.lat,selected.lon],9,{animate:true,duration:.55});renderNearby()}else renderFallback()}

function renderFallback(){const box=$('mapFallback');box.innerHTML=state.filtered.filter(e=>e.lat!=null&&e.delta24!=null).map(e=>{const left=Math.max(3,Math.min(97,(e.lon-124.5)/(132-124.5)*100));const top=Math.max(3,Math.min(97,(39.2-e.lat)/(39.2-33)*100));return `<button class="fallback-dot ${e.id===state.selected?.id?'active':''}" data-map-id="${e.id}" style="left:${left}%;top:${top}%;width:${e.id===state.selected?.id?18:11}px;height:${e.id===state.selected?.id?18:11}px;background:${colorFor(e)}" title="${esc(e.sido)} ${esc(e.county)}"></button>`}).join('');box.querySelectorAll('[data-map-id]').forEach(el=>el.addEventListener('click',()=>selectEvent(el.dataset.mapId)));renderMapReadout()}

function renderNearby(){const e=state.selected;if(!e||!state.map)return;state.nearby.clearLayers();if(e.delta24==null)return;const row=currentRow();e.airStations.forEach((s,i)=>{const pm=row?.[1+i*2];const color=pm==null?'#9ba8a3':pm>=35?'#c84d37':pm>=15?'#e49c47':'#3a9a8e';const marker=L.circleMarker([s.lat,s.lon],{radius:i===state.stationIndex?10:7,color:'#122e34',weight:i===state.stationIndex?2.5:1.5,fillColor:color,fillOpacity:.95}).bindPopup(`<b>${esc(s.name)}</b><br>PM2.5 ${pm==null?'자료 없음':fmt(pm)+' ㎍/㎥'}<br>대표점에서 ${fmt(s.km)}km`).addTo(state.nearby);marker.on('click',()=>selectStation(i))});
  const chosen=e.airStations[state.stationIndex];if(chosen){L.polyline([[e.lat,e.lon],[chosen.lat,chosen.lon]],{color:'#f07850',weight:3,opacity:.9,dashArray:'7 5'}).bindTooltip(`산불 대표점 → ${esc(chosen.name)} · ${fmt(chosen.km)}km`).addTo(state.nearby)}
  if(e.windStation){const w=e.windStation,wd=row?.[9],ws=row?.[10];const html=`<div style="width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:#173b46;color:white;border:2px solid white;box-shadow:0 2px 8px #1236;font-size:17px;transform:rotate(${wd==null?0:wd+180}deg)">↑</div>`;L.marker([w.lat,w.lon],{icon:L.divIcon({html,className:'',iconSize:[25,25],iconAnchor:[12,12]})}).bindPopup(`<b>AWS ${esc(w.name)}</b><br>${wd==null?'풍향 자료 없음':`풍향 ${fmt(wd)}° · 풍속 ${fmt(ws)}m/s`}<br>대표점에서 ${fmt(w.km)}km`).addTo(state.nearby)}renderMapReadout()}

function renderMapReadout(){const e=state.selected,row=currentRow();if(!e){$('mapReadout').textContent='사건을 선택하면 관측소가 나타납니다.';return}if(e.delta24==null){$('mapReadout').textContent=`${e.sido} ${e.county} · 전후 PM2.5 비교 불가로 지도에서 숨김`;return}const pm=row?.[1+2*state.stationIndex],wind=row?.[9];$('mapReadout').innerHTML=`<strong>${esc(e.sido)} ${esc(e.county)} · +${state.hour}시간</strong><br>PM2.5 ${pm==null?'관측 없음':`${fmt(pm)} ㎍/㎥`} · 바람 ${wind==null?'연결 없음':`${fmt(wind)}°에서 붐`}`}

function pathFor(series,index,x,y){let out='',open=false;series.forEach((row,i)=>{const v=row[index];if(v==null){open=false;return}out+=`${open?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;open=true});return out}
function renderChart(){const e=state.selected;if(!e){$('pmChart').innerHTML='';return}const pmIndex=1+2*state.stationIndex;const vals=e.series.flatMap(row=>[row[pmIndex],row[pmIndex+1]]).filter(v=>v!=null),max=Math.max(50,Math.ceil((Math.max(...vals,0)*1.12)/25)*25);const x=i=>58+i/72*800,y=v=>204-v/max*183;
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=204-t*183;return `<line x1="58" x2="858" y1="${yy}" y2="${yy}" stroke="#e3eae5"/><text x="48" y="${yy+4}" text-anchor="end" fill="#859490" font-size="10">${Math.round(t*max)}</text>`}).join('');
  const ticks=[[-24,0],[0,24],[24,48],[48,72]].map(([h,i])=>`<text x="${x(i)}" y="235" text-anchor="middle" fill="${h===0?'#dc6747':'#859490'}" font-size="11">${h===0?'발생':h>0?'+'+h+'시간':h+'시간'}</text>`).join('');const current=x(24+state.hour),p25=pathFor(e.series,pmIndex,x,y),p10=pathFor(e.series,pmIndex+1,x,y);const row=currentRow(),cy=row?.[pmIndex]!=null?`<circle cx="${current}" cy="${y(row[pmIndex])}" r="5.5" fill="#ee663f" stroke="white" stroke-width="2"/>`:'';
  $('pmChart').innerHTML=`<svg viewBox="0 0 900 250" preserveAspectRatio="none" role="img" aria-label="${esc(e.sido)} ${esc(e.county)} 산불 전후 PM2.5와 PM10 시간 그래프"><rect x="58" y="21" width="267" height="183" fill="#f3f5f1"/><rect x="325" y="21" width="533" height="183" fill="#fff8f4"/>${grid}<line x1="325" x2="325" y1="18" y2="208" stroke="#d28266" stroke-width="1.5" stroke-dasharray="5 4"/><path d="${p10}" fill="none" stroke="#427f91" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="${p25}" fill="none" stroke="#ee663f" stroke-width="2.5" vector-effect="non-scaling-stroke"/><line x1="${current}" x2="${current}" y1="21" y2="204" stroke="#425d60" stroke-width="1" stroke-dasharray="3 4"/>${cy}${ticks}<text x="58" y="15" fill="#859490" font-size="10">㎍/㎥</text></svg>`;
}

function renderDetail(){const e=state.selected;if(!e){$('detailName').textContent='검색 결과가 없습니다';$('pmChart').innerHTML='';return}const row=currentRow(),station=e.airStations[state.stationIndex],pmIndex=1+2*state.stationIndex,pm=row?.[pmIndex],wd=row?.[9],ws=row?.[10],delta=stationDelta(e,state.stationIndex);
  $('detailDate').textContent=`2024 · ${timeText(e)} 발생`;$('detailName').textContent=`${e.sido} ${e.county} 산불`;$('detailPlace').textContent=`${e.village||'세부 장소 미기재'} · 지도 위치: ${e.locationPrecision} 대표좌표 (${e.proxySites}개 관측지점 참고)`;
  $('deltaValue').textContent=delta==null?'비교 불가':`${delta>0?'+':''}${fmt(delta)} ㎍/㎥`;$('deltaValue').className=delta>0?'up':delta<0?'down':'';$('deltaCaption').textContent=station?`${station.name} · ${fmt(station.km)}km · 전후 24시간 평균 차이`:'가까운 도시대기 측정소 없음';
  $('stationName').textContent=station?`${station.name} · 대표점에서 ${fmt(station.km)}km`:'관측소 없음';$('hourLabel').textContent=`발생 시각 +${state.hour}시간`;$('readingPm').textContent=pm==null?'—':`${fmt(pm)} ㎍/㎥`;
  $('readingWind').textContent=wd==null?'연결 없음':`${fmt(wd)}° · ${fmt(ws)}m/s`;$('windStationCaption').textContent=e.windStation?`AWS ${e.windStation.name} · ${fmt(e.windStation.km)}km · 바람이 불어오는 방향`:'50km 이내 AWS 자료 없음';$('readingArea').textContent=e.areaHa==null?'—':`${fmt(e.areaHa,2)} ha`;
  $('stationList').innerHTML=e.airStations.map((s,i)=>{const d=stationDelta(e,i);return `<button type="button" class="station-chip ${i===state.stationIndex?'selected':''}" data-station="${i}" aria-pressed="${i===state.stationIndex}"><b>${esc(s.name)}</b> · ${fmt(s.km)}km · PM2.5 ${d==null?'비교 불가':`${d>0?'+':''}${fmt(d)}`}</button>`}).join('');$('stationList').querySelectorAll('[data-station]').forEach(el=>el.addEventListener('click',()=>selectStation(Number(el.dataset.station))));
  let warnings=['미세먼지 전후 비교는 다른 오염원과 날씨의 영향을 제거하지 않은 관측값입니다.'];if(e.locationPrecision!=='시군구')warnings.push('이 사건은 시군구보다 넓은 지역의 대표좌표를 사용했습니다.');if(!e.windStation)warnings.push('50km 이내에 내려받은 AWS 지점이 없어 바람을 표시하지 않습니다.');if(e.series.slice(24).some(x=>x[pmIndex]==null))warnings.push('일부 시간은 측정값이 없거나 2024년 자료 범위를 벗어납니다.');$('detailWarning').textContent=warnings.join(' ');
  renderChart();renderNearby();renderMapReadout();
}

function stopPlay(){if(state.play){clearInterval(state.play);state.play=null}$('playButton').textContent='▶ 재생'}
function togglePlay(){if(state.play){stopPlay();return}if(!state.selected)return;if(state.hour>=48){state.hour=0;$('hourSlider').value='0'}$('playButton').textContent='Ⅱ 멈춤';state.play=setInterval(()=>{state.hour+=1;if(state.hour>48){stopPlay();return}$('hourSlider').value=String(state.hour);renderDetail();window.transportUI?.renderSelected(state)},450)}

async function init(){try{const response=await fetch('./data/events_2024.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);state.events=(await response.json()).events;setStats();setupMap();['search','region','month','sort'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',applyFilters));$('hourSlider').addEventListener('input',e=>{state.hour=Number(e.target.value);renderDetail();window.transportUI?.renderSelected(state)});$('playButton').addEventListener('click',togglePlay);applyFilters()}catch(error){$('eventList').innerHTML=`<div class="event-empty">데이터를 불러오지 못했습니다. 웹 서버에서 다시 열어 주세요.<br>${esc(error.message)}</div>`;$('resultCount').textContent='DATA ERROR';console.error(error)}}
init();
