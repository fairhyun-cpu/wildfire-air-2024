(() => {
  const el = id => document.getElementById(id);
  const clean = v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const num = (v, digits = 0) => Number(v).toLocaleString('ko-KR', {maximumFractionDigits:digits});
  const fmtHour = value => value ? `${Number(value.slice(5,7))}월 ${Number(value.slice(8,10))}일 ${value.slice(11,13)}시` : '—';
  const fmtStart = value => value ? `${Number(value.slice(5,7))}월 ${Number(value.slice(8,10))}일 ${value.slice(11,16)}` : '—';
  const distanceKm = (a,b,c,d) => {const rad=Math.PI/180,p1=a*rad,p2=c*rad,dp=(c-a)*rad,dl=(d-b)*rad,h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
  const S = {data:null,event:null,hour:0,threshold:5,mode:'change',map:null,flowLayer:null,stationLayer:null,fireLayer:null,baseTiles:null,fitEventId:null,play:null,loading:null};

  function switchPhase(phase){
    const phaseTwo = phase === 2;
    if(!phaseTwo && S.play) togglePlay();
    el('phaseOne').hidden = phaseTwo;
    el('phaseTwo').hidden = !phaseTwo;
    el('phaseOneButton').classList.toggle('active', !phaseTwo);
    el('phaseTwoButton').classList.toggle('active', phaseTwo);
    el('phaseOneButton').setAttribute('aria-pressed', String(!phaseTwo));
    el('phaseTwoButton').setAttribute('aria-pressed', String(phaseTwo));
    history.replaceState(null, '', phaseTwo ? '#phase-2' : '#phase-1');
    window.scrollTo({top:0,behavior:'auto'});
    if(phaseTwo){ensureData().then(() => {initMap(); S.map?.invalidateSize(); render();}).catch(() => {});}
    else setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  }

  async function ensureData(){
    if(S.data) return;
    if(S.loading) return S.loading;
    S.loading = fetch('./data/mobility_2024.json').then(response => {
      if(!response.ok) throw new Error(`자료 요청 실패 (${response.status})`);
      return response.json();
    }).then(data => {
      S.data = data;
      const candidates = data.events.filter(event => event.hours.some(Boolean));
      S.event = candidates[0] || data.events[0];
      populate();
    }).catch(error => {el('mStatus').textContent = `자료를 불러오지 못했습니다: ${error.message}`;S.loading=null;throw error;});
    return S.loading;
  }

  function populate(){
    const d = S.data;
    const linked = d.events.filter(event => event.hours.some(hour => {
      if(!hour) return false;
      const m=metrics(hour);return m.coverage >= d.coverageMin && m.valid >= 30;
    }));
    el('mEventCount').textContent = num(d.events.length);
    el('mValidCount').textContent = num(linked.length);
    el('mStationCount').textContent = num(d.stations.length);
    el('mDayCount').textContent = `${d.processedDays}/${d.requiredDays}`;
    const check=d.directionCheck;
    el('mActualAlignment').textContent=check?`${num(check.pmUnder45Pct,1)}%`:'—';
    el('mLayoutAlignment').textContent=check?`${num(check.layoutUnder45Pct,1)}%`:'—';
    el('mSanityNote').textContent=check
      ? `기본 기준 5 ㎍/㎥, 악화 관측소 3곳 이상, 두 중심 방향이 계산되는 ${num(check.eligibleEventHours)}개 사건·시간에서의 탐색적 비교입니다. 관측소 위치만으로 만든 기준선이 더 자주 일치합니다. 같은 사건의 시간들이 반복되며 수도권 관측소·이동 목적지가 도시 쪽에 몰린 효과를 분리하지 못하므로, 이 수치를 연기가 사람과 같은 방향으로 이동했다는 증거로 해석할 수 없습니다.`
      : '방향 비교 자료가 없습니다.';
    const origins = [...new Map(d.events.map(event => [event.origin, d.zones[event.origin]])).entries()]
      .sort((a,b) => (a[1][0]).localeCompare(b[1][0], 'ko'));
    el('mOrigin').innerHTML = '<option value="">전체 출발 지역</option>' + origins.map(([i,z]) => `<option value="${i}">${clean(z[0].replace('|',' '))}</option>`).join('');
    renderEventOptions();
  }

  function renderEventOptions(){
    const filter = el('mOrigin').value;
    const events = S.data.events.filter(event => !filter || String(event.origin) === filter);
    if(!events.some(event => event.id === S.event?.id)) S.event = events.find(event => event.hours.some(Boolean)) || events[0] || null;
    el('mEvent').innerHTML = events.map(event => {
      const date = event.start.slice(5,10).replace('-', '.');
      const available = event.hours.some(Boolean);
      return `<option value="${clean(event.id)}" ${S.event?.id === event.id ? 'selected' : ''}>${date} ${clean(event.start.slice(11,16))} · ${clean(event.sido)} ${clean(event.county)}${available ? '' : ' · 자료 없음'}</option>`;
    }).join('');
    S.hour = 0;el('mHour').value = '0';render();
  }

  function metrics(hour){
    if(!hour) return {total:0,valid:0,hot:0,other:0,unknown:0,coverage:0,share:null};
    const originPm = hour.o;
    let total = hour.u || 0, valid = 0, hot = 0, other = 0;
    for(const [di,cnt,delta,pm] of hour.f){
      total += cnt;
      const change = S.mode === 'change' ? delta : (pm != null && originPm != null ? pm - originPm : null);
      if(change == null) continue;
      valid += cnt;
      if(change >= S.threshold) hot += cnt; else other += cnt;
    }
    const unknown = Math.max(0,total-valid);
    return {total,valid,hot,other,unknown,coverage:total ? valid/total : 0,
            share:valid ? hot/valid : null};
  }

  function render(){
    if(!S.data || !S.event) return;
    const e = S.event, hour = e.hours[S.hour], m = metrics(hour);
    const show = hour && m.coverage >= S.data.coverageMin && m.valid >= 30;
    el('mMetricLabel').textContent = S.mode === 'change' ? '공기가 나빠진 곳으로 간 이동' : '출발지보다 공기가 나쁜 곳으로 간 이동';
    el('mShareCaption').textContent = S.mode === 'change' ? `산불 전 같은 시각보다 +${S.threshold} ㎍/㎥ 이상` : `출발지보다 +${S.threshold} ㎍/㎥ 이상`;
    el('mMapColorKey').textContent = S.mode === 'change' ? '이동선 색은 산불 전 대비 목적지 PM2.5 변화입니다.' : '이동선 색은 같은 시간 출발지 대비 목적지 PM2.5 차이입니다.';
    el('mShare').textContent = show ? `${num(m.share*100,1)}%` : '—';
    el('mCoverage').textContent = hour && m.total ? `${num(m.coverage*100,1)}%` : '—';
    el('mCoverageCaption').textContent = hour ? `유효 ${num(m.valid)} / 전체 ${num(m.total)} 추정 이동량` : '해당 시간의 이동 자료 없음';
    el('mEventHeadline').textContent = `${e.sido} ${e.county} 산불 · ${fmtStart(e.start)}`;
    el('mTimeText').textContent = `${hour ? fmtHour(hour.t) : '관측 자료 없음'} · 발생 후 +${S.hour}시간`;
    el('mHourLabel').textContent = `+${S.hour}시간`;
    el('mStatus').textContent = !hour ? (S.hour && new Date(e.zero).getFullYear() === 2024 && new Date(new Date(e.zero).getTime()+S.hour*3600000).getFullYear() > 2024 ? '2025년 이동·PM 자료가 없어 이 시간은 제외했습니다.' : '해당 시간의 이동 자료가 없습니다.')
      : !show ? `관측소 연결률 ${num(m.coverage*100,1)}%. 70% 미만이거나 유효 이동량 30 미만이므로 비율을 숨깁니다.`
      : '비율은 추정 이동량 기준입니다. 같은 시간의 방향 일치가 산불의 영향이나 개인의 회피 행동을 뜻하지 않습니다.';
    renderDots(show ? m.share : null);
    renderTimeline();
    renderDestinations(hour);
    renderMap(hour);
  }

  function renderDots(share){
    const hot = share == null ? 0 : Math.round(share*100);
    el('mDots').innerHTML = Array.from({length:100},(_,i) => `<i class="${share == null ? 'unknown' : i<hot ? 'hot' : ''}"></i>`).join('');
    el('mDots').setAttribute('aria-label', share == null ? '비율을 계산할 수 없습니다' : `관측 가능한 추정 이동량 100개 중 약 ${hot}개가 기준에 해당`);
  }

  function renderTimeline(){
    const values = S.event.hours.map(metrics), width=970, top=7,height=76, col=width/49;
    const bars = values.map((m,i) => {
      const x=15+i*col, valid=m.total>0, hot=valid?m.hot/m.total:0, other=valid?m.other/m.total:0, unknown=valid?m.unknown/m.total:1;
      return `<g data-hour="${i}" style="cursor:pointer"><rect x="${x}" y="${top}" width="${col-1}" height="${height*unknown}" fill="#aab8b6"/><rect x="${x}" y="${top+height*unknown}" width="${col-1}" height="${height*other}" fill="#a4c7bd"/><rect x="${x}" y="${top+height*(unknown+other)}" width="${col-1}" height="${height*hot}" fill="#e57759"/><title>+${i}시간 · 악화 ${num(hot*100,1)}% · 그 외 ${num(other*100,1)}% · 미측정 ${num(unknown*100,1)}%</title></g>`;
    }).join('');
    const x=15+S.hour*col+col/2;
    const ticks=[0,12,24,36,48].map(h=>`<text x="${15+h*col+col/2}" y="107" text-anchor="middle" fill="#718487" font-size="12">+${h}h</text>`).join('');
    el('mTimeline').innerHTML=`<svg viewBox="0 0 1000 114" preserveAspectRatio="none"><rect x="15" y="7" width="970" height="76" fill="#e8eeeb"/>${bars}<line x1="${x}" x2="${x}" y1="2" y2="87" stroke="#17363d" stroke-width="2"/>${ticks}</svg>`;
    el('mTimeline').querySelectorAll('[data-hour]').forEach(node=>node.addEventListener('click',()=>setHour(Number(node.dataset.hour))));
  }

  function renderDestinations(hour){
    if(!hour){el('mDestinationList').innerHTML='<p class="event-empty">이 시간에는 연결된 이동 자료가 없습니다.</p>';return;}
    const sorted=hour.f.filter(row=>row[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8), max=sorted[0]?.[1] || 1;
    el('mDestinationList').innerHTML=sorted.map(([di,cnt,delta,pm,stationN])=>{
      const zone=S.data.zones[di], change=S.mode==='change'?delta:(pm!=null&&hour.o!=null?pm-hour.o:null);
      const hot=change!=null&&change>=S.threshold;
      const text=change==null?'PM 비교 불가':`${change>=0?'+':''}${num(change,1)} ㎍/㎥`;
      return `<div class="mobility-destination ${hot?'rose':''}"><strong>${clean(zone[0].replace('|',' '))}${di===S.event.origin?' (지역 내)':''}</strong><span class="bar"><i style="width:${Math.max(2,cnt/max*100).toFixed(1)}%"></i></span><b title="추정 이동량">${num(cnt)}</b><small title="전후 동일 도시대기 관측소 ${stationN}곳">${text} · ${stationN}곳</small></div>`;
    }).join('') || '<p class="event-empty">표시할 목적지가 없습니다.</p>';
  }

  function initMap(){
    if(S.map) return;
    if(!window.L){el('mMap').innerHTML='<div class="event-empty">지도를 불러오지 못했습니다. 관측·이동 수치는 계속 확인할 수 있습니다.</div>';return;}
    S.map=L.map('mMap',{zoomControl:true,preferCanvas:true,attributionControl:true}).setView([37.54,126.98],9);
    S.baseTiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'});
    for(const [name,z] of [['mStations',420],['mFlows',560],['mFires',610]]){
      S.map.createPane(name).style.zIndex=z;
    }
    S.stationLayer=L.layerGroup().addTo(S.map);
    S.flowLayer=L.layerGroup().addTo(S.map);
    S.fireLayer=L.layerGroup().addTo(S.map);
  }

  function centers(hour){
    if(!hour) return {air:null,move:null,stationCount:0};
    let ay=0,ax=0,aw=0,stationCount=0,my=0,mx=0,mw=0;
    for(const [si,delta] of hour.s){
      if(delta == null || delta < S.threshold || delta <= 0) continue;
      const st=S.data.stations[si], weight=Math.min(delta,80);
      ay+=st[2]*weight;ax+=st[3]*weight;aw+=weight;stationCount++;
    }
    for(const [di,cnt] of hour.f){
      const z=S.data.zones[di];
      my+=z[2]*cnt;mx+=z[3]*cnt;mw+=cnt;
    }
    return {air:stationCount>=3?[ay/aw,ax/aw]:null,move:mw>0?[my/mw,mx/mw]:null,stationCount};
  }

  function directionAngle(e,air,move){
    if(!air||!move) return null;
    const origin=S.data.zones[e.origin], lat=origin[2],scale=Math.cos(lat*Math.PI/180);
    const a=[(air[1]-e.lon)*scale,air[0]-e.lat], b=[(move[1]-origin[3])*scale,move[0]-origin[2]];
    const na=Math.hypot(...a),nb=Math.hypot(...b);
    if(na<.045||nb<.045) return null;
    return Math.acos(Math.max(-1,Math.min(1,(a[0]*b[0]+a[1]*b[1])/(na*nb))))*180/Math.PI;
  }

  function renderMap(hour){
    if(!S.map || !S.event) return;
    S.flowLayer.clearLayers();S.stationLayer.clearLayers();S.fireLayer.clearLayers();
    const e=S.event, origin=S.data.zones[e.origin];
    if(!hour){el('mDirection').textContent='이 시간의 이동·관측 자료가 없습니다.';return;}
    const flows=hour.f.filter(f=>f[1]>0 && f[0]!==e.origin).sort((a,b)=>b[1]-a[1]).slice(0,20);
    const max=flows[0]?.[1] || 1;
    for(const [si,delta,pm] of hour.s){
      if(delta==null) continue;
      const station=S.data.stations[si], color=delta>=S.threshold?'#df674d':delta<0?'#3d8596':'#78aba1';
      L.circleMarker([station[2],station[3]],{pane:'mStations',radius:Math.min(6,2.5+Math.sqrt(Math.abs(delta))*.4),color:'#fffefa',weight:.8,fillColor:color,fillOpacity:.7})
        .bindPopup(`<b>${clean(station[1])}</b><br>현재 PM2.5 ${num(pm,1)} ㎍/㎥<br>산불 전 같은 시각 대비 ${delta>=0?'+':''}${num(delta,1)} ㎍/㎥<br>산불 지역 대표점과 약 ${num(distanceKm(e.lat,e.lon,station[2],station[3]),1)} km<br>${clean(S.data.zones[station[4]][0])} 도시대기 관측소`)
        .addTo(S.stationLayer);
    }
    const links=flows.map(([di,cnt,delta,pm])=>{
      const z=S.data.zones[di], change=S.mode==='change'?delta:(pm!=null&&hour.o!=null?pm-hour.o:null);
      const color=change==null?'#8a9895':change>=S.threshold?'#d9472f':change<0?'#17758d':'#5a9185';
      return {di,cnt,z,change,color,weight:2.5+5.5*Math.sqrt(cnt/max),path:[[origin[2],origin[3]],[z[2],z[3]]]};
    });
    for(const link of links){
      L.polyline(link.path,{pane:'mFlows',color:'#fffdf4',weight:link.weight+4.5,opacity:.96,interactive:false}).addTo(S.flowLayer);
    }
    for(const link of links){
      L.polyline(link.path,{pane:'mFlows',color:link.color,weight:link.weight,opacity:.98,lineCap:'round'})
        .bindTooltip(`${clean(origin[0])} → ${clean(link.z[0])}<br>추정 이동량 ${num(link.cnt)} · ${link.change==null?'PM 비교 불가':`PM2.5 차이 ${link.change>=0?'+':''}${num(link.change,1)} ㎍/㎥`}`)
        .addTo(S.flowLayer);
    }
    for(const link of links.slice(0,5)){
      L.circleMarker([link.z[2],link.z[3]],{pane:'mFlows',radius:5,color:'#fffdf4',weight:2,fillColor:link.color,fillOpacity:1})
        .bindTooltip(clean(link.z[0].replace('|',' ')),{permanent:true,direction:'right',offset:[5,0],className:'mobility-place-label'})
        .addTo(S.flowLayer);
    }
    L.circleMarker([e.lat,e.lon],{pane:'mFires',radius:10,color:'#17353c',weight:2,fillColor:'#ffba7f',fillOpacity:1})
      .bindPopup(`<b>${clean(e.sido)} ${clean(e.county)} 산불</b><br>${clean(fmtHour(e.start))}<br>점은 시군구 대표점이며 실제 발화 좌표가 아닙니다.`)
      .addTo(S.fireLayer);
    L.circleMarker([origin[2],origin[3]],{pane:'mFires',radius:6,color:'#17353c',weight:2,fillColor:'#fff',fillOpacity:1})
      .bindTooltip(`출발: ${clean(origin[0].replace('|',' '))}`,{permanent:true,direction:'left',offset:[-6,0],className:'mobility-origin-label'}).addTo(S.fireLayer);
    const layoutStations=S.data.stations.filter(st=>distanceKm(e.lat,e.lon,st[2],st[3])<=110);
    const layout=layoutStations.length
      ? [layoutStations.reduce((sum,st)=>sum+st[2],0)/layoutStations.length,
         layoutStations.reduce((sum,st)=>sum+st[3],0)/layoutStations.length]
      : null;
    const c=centers(hour),angle=directionAngle(e,c.air,c.move),layoutAngle=directionAngle(e,layout,c.move);
    el('mDirection').textContent=angle==null
      ? `방향 각도 계산 보류 · 악화 관측소 ${c.stationCount}곳 또는 중심 이동거리가 부족합니다.`
      : `악화 관측소 ↔ 이동 목적지 ${num(angle,0)}° · 관측소 배치만 쓴 기준 ${layoutAngle==null?'—':num(layoutAngle,0)+'°'} · 악화 관측소 ${c.stationCount}곳`;
    if(S.fitEventId!==e.id){
      const topDestinations=new Set(e.hours.filter(Boolean).flatMap(item=>
        item.f.filter(row=>row[1]>0 && row[0]!==e.origin).sort((a,b)=>b[1]-a[1]).slice(0,20).map(row=>row[0])));
      const points=[[e.lat,e.lon],[origin[2],origin[3]],...[...topDestinations].map(di=>[S.data.zones[di][2],S.data.zones[di][3]])];
      if(S.map.fitBounds && L.latLngBounds) S.map.fitBounds(L.latLngBounds(points),{padding:[55,55],maxZoom:10,animate:false});
      else S.map.setView([e.lat,e.lon], e.sido==='서울'?10:9, {animate:false});
      S.fitEventId=e.id;
    }
  }

  function setHour(h){S.hour=Math.max(0,Math.min(48,h));el('mHour').value=String(S.hour);render();}
  function setMode(mode){S.mode=mode;for(const [id,active] of [['mModeChange',mode==='change'],['mModeWorse',mode==='worse']]){el(id).classList.toggle('active',active);el(id).setAttribute('aria-pressed',String(active));}render();}
  function togglePlay(){if(S.play){clearInterval(S.play);S.play=null;el('mPlay').textContent='▶ 재생';return;}el('mPlay').textContent='Ⅱ 일시정지';S.play=setInterval(()=>{if(S.hour>=48){togglePlay();return;}setHour(S.hour+1);},850);}

  el('phaseOneButton').addEventListener('click',()=>switchPhase(1));
  el('phaseTwoButton').addEventListener('click',()=>switchPhase(2));
  el('mOrigin').addEventListener('change',renderEventOptions);
  el('mEvent').addEventListener('change',()=>{S.event=S.data.events.find(e=>e.id===el('mEvent').value);setHour(0);});
  el('mHour').addEventListener('input',()=>setHour(Number(el('mHour').value)));
  el('mThreshold').addEventListener('input',()=>{S.threshold=Number(el('mThreshold').value);el('mThresholdValue').value=String(S.threshold);render();});
  el('mModeChange').addEventListener('click',()=>setMode('change'));
  el('mModeWorse').addEventListener('click',()=>setMode('worse'));
  el('mBasemap').addEventListener('click',()=>{
    if(!S.map) return;
    const active=S.map.hasLayer(S.baseTiles);
    if(active) S.map.removeLayer(S.baseTiles); else S.baseTiles.addTo(S.map);
    el('mBasemap').textContent=active?'실제 지도 보기':'단색 지도 보기';
    el('mBasemap').setAttribute('aria-pressed',String(!active));
    el('mMap').classList.toggle('with-tiles',!active);
  });
  el('mPlay').addEventListener('click',togglePlay);
  if(location.hash==='#phase-2') switchPhase(2);
})();
