(function(){
  const canvas = document.getElementById('hero-canvas');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const bgTexture = new THREE.TextureLoader().load('img/8k_stars_milky_way.jpg');
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  bgTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = bgTexture;

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 220);
  camera.position.set(0, 0.6, 9);

  // ---- lighting: the sun itself is now the main light source ----
  scene.add(new THREE.AmbientLight(0x2a3550, 0.9));
  const sunLight = new THREE.PointLight(0xfff1c6, 3.2, 60);
  const fill = new THREE.PointLight(0x4a6fa8, 0.6, 40);
  fill.position.set(-8,-4,-8);
  scene.add(fill);

  // ---- glow sprite texture ----
  function glowTexture(hex){
    const c = document.createElement('canvas'); c.width=c.height=128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64,64,0,64,64,64);
    g.addColorStop(0, hex + 'ff'); g.addColorStop(0.35, hex + '88'); g.addColorStop(1, hex + '00');
    ctx.fillStyle = g; ctx.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(c);
  }
  const glowTexWarm = glowTexture('#ffcf7d');

  // ---- procedural surface textures (equirectangular canvas) ----
  function hexToRgb(hex){
    const n = parseInt(hex.replace('#',''),16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function rgba(hex, a){ const [r,g,b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  function makePlanetTexture(base, accent, bands){
    const w=512, h=256;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0,0,w,h);
    if(bands){
      const bandCount = 9;
      for(let i=0;i<bandCount;i++){
        ctx.fillStyle = rgba(accent, 0.28 + Math.random()*0.22);
        const y = (i/bandCount)*h;
        ctx.fillRect(0, y, w, h/bandCount + 2);
      }
    }
    const blobs = bands ? 55 : 90;
    for(let i=0;i<blobs;i++){
      const x = Math.random()*w, y = Math.random()*h, r = 8 + Math.random()*36;
      ctx.beginPath();
      ctx.fillStyle = rgba(accent, 0.06 + Math.random()*0.14);
      ctx.ellipse(x, y, r, r*0.55, Math.random()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

function makeSunTexture(){
    const w=512, h=256;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, '#ffe9a8'); grad.addColorStop(0.5, '#ffb85c'); grad.addColorStop(1, '#ff8a3d');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    for(let i=0;i<160;i++){
      const x = Math.random()*w, y = Math.random()*h, r = 6 + Math.random()*30;
      ctx.beginPath();
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,220,0.18)' : 'rgba(200,80,20,0.16)';
      ctx.ellipse(x, y, r, r*0.5, Math.random()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  const textureLoader = new THREE.TextureLoader();

  // ---- root group (draggable) ----
  // The sun sits at 2/5 of the galaxy's radius from the true galactic center,
  // not at the center itself — the black hole added below takes that spot.
  const GALAXY_RADIUS = 50;
  const SUN_ORBIT_RADIUS = GALAXY_RADIUS * 0.4;
  const SUN_ORBIT_ANGLE = Math.PI * 0.22;
  const root = new THREE.Group();
  root.position.set(Math.cos(SUN_ORBIT_ANGLE)*SUN_ORBIT_RADIUS, 0, Math.sin(SUN_ORBIT_ANGLE)*SUN_ORBIT_RADIUS);
  scene.add(root);

  // ---- depth fog so the far side of the system fades away ----
  scene.fog = new THREE.FogExp2(0x0a1410, 0.013);

  // ---- the sun ----
  const sunGroup = new THREE.Group();
  root.add(sunGroup);
  sunGroup.add(sunLight);

  const sunGeo = new THREE.SphereGeometry(1.3, 64, 48);
  const sunTex = textureLoader.load('img/8k_sun.jpg');
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunMat = new THREE.MeshBasicMaterial({ map: sunTex });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.userData = { planet:'The Sun', label:'Curiosity', desc:'The constant that everything else here orbits. From galactic scale it\'s just one ordinary star among billions.' };
  sunGroup.add(sunMesh);

  // declared early so later code (black hole, planets, moons, comet) can all push into it
  const nodeMeshes = [ sunMesh ];
  const traceLines = [];
  const moonPivots = [];

  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexWarm, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending }));
  coreGlow.scale.set(5.6,5.6,1);
  sunGroup.add(coreGlow);

  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexWarm, transparent:true, opacity:0.28, blending:THREE.AdditiveBlending }));
  corona.scale.set(9,9,1);
  sunGroup.add(corona);

  // ---- starfield (pushed further out so it stays behind the widest orbit) ----
  const starCount = 1400;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    const r = 26 + Math.random()*48;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos((Math.random()*2)-1);
    starPos[i*3] = r*Math.sin(phi)*Math.cos(theta);
    starPos[i*3+1] = r*Math.sin(phi)*Math.sin(theta);
    starPos[i*3+2] = r*Math.cos(phi);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
  const starMat = new THREE.PointsMaterial({ color:0xcfe0ff, size:0.05, transparent:true, opacity:0.75, fog:false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ---- asteroid belt (between Mars and Jupiter) ----
  const beltCount = 500;
  const beltGeo = new THREE.BufferGeometry();
  const beltPos = new Float32Array(beltCount*3);
  for(let i=0;i<beltCount;i++){
    const r = 5.7 + Math.random()*0.8;
    const theta = Math.random()*Math.PI*2;
    beltPos[i*3] = r*Math.cos(theta);
    beltPos[i*3+1] = (Math.random()-0.5)*0.3;
    beltPos[i*3+2] = r*Math.sin(theta);
  }
  beltGeo.setAttribute('position', new THREE.BufferAttribute(beltPos,3));
  const beltMat = new THREE.PointsMaterial({ color:0xaba192, size:0.032, transparent:true, opacity:0.6 });
  const belt = new THREE.Points(beltGeo, beltMat);
  sunGroup.add(belt);

  // ---- distant galaxy, styled directly after real photographs of Andromeda (M31):
  // a huge smooth golden bulge, a broad pale extremely-flattened disk, dark dust
  // lanes crossing the near side, and two small companion galaxies echoing
  // M32 and M110, revealed as the camera pulls back ----
  function makeGalaxyStars(opts){
    opts = opts || {};
    const armCount = opts.armCount || 2;
    const perArm = opts.perArm || 6000;
    const coreCount = opts.coreCount || 2600;
    const maxRadius = opts.maxRadius || GALAXY_RADIUS;
    const turns = opts.turns || 1.4;
    const flatten = opts.flatten || 0.18;
    const pointSize = opts.pointSize || 0.15;
    const total = armCount*perArm + coreCount;
    const positions = new Float32Array(total*3);
    const colors = new Float32Array(total*3);

    const armColorInner = new THREE.Color(opts.colorInner || '#fff3d9');
    const armColorOuter = new THREE.Color(opts.colorOuter || '#cfd8e6');
    const dustColor = new THREE.Color(opts.dustColor || '#221912');
    const coreColor = new THREE.Color(opts.coreColor || '#fff8e8');

    let idx = 0;

    for(let a=0; a<armCount; a++){
      const armOffset = (a/armCount) * Math.PI*2;
      for(let i=0;i<perArm;i++){
        const t = i/perArm;
        const radius = Math.pow(t, 0.5) * maxRadius;
        const spread = (1-t)*1.3 + 0.35;
        const jitter = (Math.random()-0.5) * spread;
        const angle = armOffset + t*turns*Math.PI*2 + jitter*0.5;
        const r = Math.max(1.0, radius + (Math.random()-0.5)*spread*2.6);
        const y = (Math.random()-0.5) * (0.3 + (1-t)*0.9) * flatten;

        positions[idx*3]   = Math.cos(angle) * r;
        positions[idx*3+1] = y;
        positions[idx*3+2] = Math.sin(angle) * r;

        let col = armColorInner.clone().lerp(armColorOuter, t);
        // dark dust lanes tracing the near side of the disk, like Andromeda's famous lanes
        const nearMidPlane = Math.abs(y) < 0.22*flatten;
        const laneSide = Math.sin(angle*1.15) > 0.1;
        if(nearMidPlane && laneSide && Math.random() < 0.6){
          col = col.clone().lerp(dustColor, 0.7);
        } else if(Math.random() < 0.05){
          col = col.clone().lerp(dustColor, 0.3);
        }

        colors[idx*3]=col.r; colors[idx*3+1]=col.g; colors[idx*3+2]=col.b;
        idx++;
      }
    }

    for(let i=0;i<coreCount;i++){
      const bulgeR = maxRadius*0.14;
      const r = Math.pow(Math.random(), 2.3) * bulgeR;
      const angle = Math.random()*Math.PI*2;
      positions[idx*3]   = Math.cos(angle) * r;
      positions[idx*3+1] = (Math.random()-0.5) * 2.1 * flatten * (1 - r/bulgeR);
      positions[idx*3+2] = Math.sin(angle) * r;

      const col = coreColor.clone().lerp(armColorInner, Math.random()*0.3);
      colors[idx*3]=col.r; colors[idx*3+1]=col.g; colors[idx*3+2]=col.b;
      idx++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    const mat = new THREE.PointsMaterial({
      size:pointSize, vertexColors:true, transparent:true, opacity:0,
      depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true, fog:false
    });
    return new THREE.Points(geo, mat);
  }

  function makeDustPatchTexture(){
    const w=256, h=256;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(w/2,h/2,0, w/2,h/2,w/2);
    g.addColorStop(0,   'rgba(18,13,9,0.95)');
    g.addColorStop(0.5, 'rgba(18,13,9,0.55)');
    g.addColorStop(1,   'rgba(18,13,9,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    return new THREE.CanvasTexture(c);
  }
  const dustPatchTex = makeDustPatchTexture();

  // a container so every part of the main galaxy (stars, glows, dust, companions)
  // shares one slow, gentle rotation relative to Sagittarius A*
  const galaxyGroup = new THREE.Group();
  scene.add(galaxyGroup);

  const galaxy = makeGalaxyStars({
    armCount:2, perArm:6000, coreCount:2600, maxRadius:GALAXY_RADIUS,
    turns:1.4, flatten:0.18, pointSize:0.15,
    colorInner:'#fff3d9', colorOuter:'#cfd8e6', dustColor:'#221912', coreColor:'#fff8e8'
  });
  galaxyGroup.add(galaxy);

  // the huge smooth, pale, extremely elongated halo that dominates real astrophotos —
  // a camera-facing sprite stretched into an ellipse, matching the flattened silhouette
  const galaxyHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xd9cfba, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  }));
  galaxyHalo.scale.set(76, 24, 1);
  galaxyGroup.add(galaxyHalo);

  const galaxyBulgeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xfff1cf, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  }));
  galaxyBulgeGlow.scale.set(24, 12, 1);
  galaxyGroup.add(galaxyBulgeGlow);

  const galaxyCoreHot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xfff9e9, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  }));
  galaxyCoreHot.scale.set(10, 5.5, 1);
  galaxyGroup.add(galaxyCoreHot);

  // dark dust lanes drawn on top of the glow, offset from center and angled slightly
  const dustLane1 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dustPatchTex, transparent:true, opacity:0, depthWrite:false, fog:false
  }));
  dustLane1.scale.set(52, 7, 1);
  dustLane1.position.set(5, -1.6, 0.4);
  dustLane1.material.rotation = 0.1;
  galaxyGroup.add(dustLane1);

  const dustLane2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dustPatchTex, transparent:true, opacity:0, depthWrite:false, fog:false
  }));
  dustLane2.scale.set(44, 5.5, 1);
  dustLane2.position.set(-7, 2, 0.4);
  dustLane2.material.rotation = -0.08;
  galaxyGroup.add(dustLane2);

  // invisible marker at the galactic core so the galaxy itself is hoverable/clickable
  const galaxyCoreMarker = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 16),
    new THREE.MeshBasicMaterial({ transparent:true, opacity:0 })
  );
  galaxyCoreMarker.userData = { planet:'Andromeda', label:'M31', desc:'The spiral galaxy the sun and every planet here quietly belongs to, seen here nearly edge-on.' };
  galaxyGroup.add(galaxyCoreMarker);
  nodeMeshes.push(galaxyCoreMarker);

  // two small companion galaxies close to the disk, echoing M32 (compact, bright)
  // and M110 (larger, diffuse) from the real photograph
  const companionM32 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xfff7e2, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  }));
  companionM32.scale.set(3, 3, 1);
  companionM32.position.set(-10, 5.5, 3);
  galaxyGroup.add(companionM32);

  const companionM32Marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 12, 12),
    new THREE.MeshBasicMaterial({ transparent:true, opacity:0 })
  );
  companionM32Marker.position.copy(companionM32.position);
  companionM32Marker.userData = { planet:'M32', label:'Companion Galaxy', desc:'A small, compact companion galaxy caught close against Andromeda\'s disk.' };
  galaxyGroup.add(companionM32Marker);
  nodeMeshes.push(companionM32Marker);

  const companionM110 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xe9e3d6, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  }));
  companionM110.scale.set(7, 4.4, 1);
  companionM110.position.set(-3.5, -15, 3);
  galaxyGroup.add(companionM110);

  const companionM110Marker = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 12),
    new THREE.MeshBasicMaterial({ transparent:true, opacity:0 })
  );
  companionM110Marker.position.copy(companionM110.position);
  companionM110Marker.userData = { planet:'M110', label:'Companion Galaxy', desc:'A larger, dust-free dwarf companion drifting just below Andromeda\'s disk.' };
  galaxyGroup.add(companionM110Marker);
  nodeMeshes.push(companionM110Marker);

  // ---- black hole: the true galactic center, distinct from the sun, styled after
  // the Event Horizon Telescope image of Sagittarius A* — a bright, lopsided ring
  // of glowing gas around a dark shadow ----
  function makeAccretionTexture(){
    const w=512, h=128;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,    'rgba(255,255,255,0)');
    g.addColorStop(0.12, 'rgba(255,248,222,0.95)');
    g.addColorStop(0.32, 'rgba(255,176,71,0.9)');
    g.addColorStop(0.6,  'rgba(255,91,46,0.55)');
    g.addColorStop(1,    'rgba(150,30,15,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

    // Doppler-beaming crescent: one side of the ring brighter than the other,
    // just like the real Sagittarius A* image
    const crescent = ctx.createRadialGradient(w*0.28, h*0.32, 0, w*0.28, h*0.32, w*0.42);
    crescent.addColorStop(0, 'rgba(255,255,235,0.55)');
    crescent.addColorStop(1, 'rgba(255,255,235,0)');
    ctx.fillStyle = crescent; ctx.fillRect(0,0,w,h);

    for(let i=0;i<50;i++){
      const x = Math.random()*w, y = Math.random()*h, r = 4+Math.random()*10;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,'+(0.05+Math.random()*0.12)+')';
      ctx.ellipse(x, y, r, r*0.4, 0, 0, Math.PI*2);
      ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  const blackHole = new THREE.Group();
  blackHole.visible = false; // hidden during the solar-system view — it only belongs to the galaxy-scale shot
  scene.add(blackHole);

  const eventHorizon = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 48, 32),
    new THREE.MeshBasicMaterial({ color:0x000000 })
  );
  eventHorizon.userData = { planet:'Sagittarius A*', label:'Supermassive Black Hole', desc:'The true center of the galaxy — everything here, including the sun, slowly orbits it from a distance.' };
  blackHole.add(eventHorizon);
  nodeMeshes.push(eventHorizon);

  const diskPivot = new THREE.Object3D();
  diskPivot.rotation.x = Math.PI/2; // lay the disk flat in the galaxy's orbital plane
  blackHole.add(diskPivot);

  const diskGeo = new THREE.RingGeometry(1.6, 4.4, 96, 1);
  const diskMat = new THREE.MeshBasicMaterial({
    map: makeAccretionTexture(), transparent:true, opacity:0, side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false
  });
  const accretionDisk = new THREE.Mesh(diskGeo, diskMat);
  diskPivot.add(accretionDisk);

  const holeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexWarm, color:0xffb347, transparent:true, opacity:0, blending:THREE.AdditiveBlending, fog:false
  }));
  holeGlow.scale.set(6,6,1);
  blackHole.add(holeGlow);

  // ---- planets, in real solar-system order, each one a language / tool in the stack ----
  const nodeData = [
    { planet:'Mercury', label:'ASM', desc:'NASM interrupt stubs and the raw registers behind every syscall.', base:'#9c9c94', accent:'#d8d8cc', radius:2.2, speed:0.42, incX:0.25, incZ:0.08, size:0.13, texture:'img/2k_mercury.jpg' },
    { planet:'Venus', label:'Bash', desc:'Glue scripts, build steps, and late-night debugging.', base:'#d9b382', accent:'#f0dcae', radius:2.9, speed:0.30, incX:-0.35, incZ:0.4, size:0.19, texture:'img/2k_venus_surface.jpg' },
    { planet:'Earth', label:'C', desc:'Kernel & bootloader work. Everything in KeblaOS starts here.', base:'#2b6cb0', accent:'#3f9142', radius:3.7, speed:0.24, incX:0.15, incZ:-0.2, size:0.2, texture:'img/2k_earth_daymap.jpg',
      moons:[ { name:'Moon', label:'KeblaOS', desc:'The kernel itself — a satellite of everything written in C.', size:0.055, dist:0.36, speed:2.2, texture:'img/2k_moon.jpg' } ] },
    { planet:'Mars', label:'Python', desc:'Scripting, tooling, and the Flask API behind the local AI stack.', base:'#b1440e', accent:'#d97a4d', radius:4.6, speed:0.19, incX:-0.5, incZ:0.15, size:0.16, texture:'img/2k_mars.jpg',
      moons:[
        { name:'Phobos', label:'Flask', desc:'The API layer behind the local AI chat stack.', size:0.03, dist:0.26, speed:3.4 },
        { name:'Deimos', label:'Scripts', desc:'Small automation and glue scripts written in Python.', size:0.024, dist:0.34, speed:2.6 }
      ] },
    { planet:'Jupiter', label:'HTML/JS', desc:'Frontends — including the solar system you\'re looking at.', base:'#c9a26b', accent:'#8a6a4a', radius:7.4, speed:0.10, incX:0.3, incZ:0.5, size:0.42, bands:true, texture:'img/2k_jupiter.jpg',
      moons:[
        { name:'Io', label:'Three.js', desc:'The engine rendering this very scene.', size:0.05, dist:0.62, speed:1.9 },
        { name:'Europa', label:'CSS', desc:'Styling and layout for every page.', size:0.045, dist:0.78, speed:1.5 },
        { name:'Ganymede', label:'Canvas', desc:'Procedural textures for planets, drawn pixel by pixel.', size:0.06, dist:0.95, speed:1.2 },
        { name:'Callisto', label:'DOM', desc:'The scroll-driven boot sequence and terminal UIs.', size:0.048, dist:1.12, speed:0.95 }
      ] },
    { planet:'Saturn', label:'C#', desc:'.NET desktop apps when the target is Windows.', base:'#d9c27e', accent:'#f0e0a8', radius:9.0, speed:0.08, incX:-0.2, incZ:-0.55, size:0.34, ring:true, texture:'img/2k_saturn.jpg', ringTexture:'img/2k_saturn_ring_alpha.png',
      moons:[ { name:'Titan', label:'.NET', desc:'The runtime behind Windows desktop tools.', size:0.05, dist:0.7, speed:1.1 } ] },
    { planet:'Uranus', label:'Java', desc:'Android client for the offline voice chat app.', base:'#7fd6d6', accent:'#bfefef', radius:10.4, speed:0.06, incX:0.6, incZ:0.3, size:0.26, texture:'img/2k_uranus.jpg',
      moons:[ { name:'Titania', label:'Android SDK', desc:'MediaProjection API and Mjpg screen mirroring.', size:0.04, dist:0.46, speed:1.6 } ] },
    { planet:'Neptune', label:'Fortran', desc:'The odd numerics project, mostly for fun.', base:'#2d5986', accent:'#4a7fae', radius:11.8, speed:0.05, incX:-0.4, incZ:-0.35, size:0.25, texture:'img/2k_neptune.jpg' },
];

  nodeData.forEach(d => {
    const pivot = new THREE.Object3D();
    pivot.rotation.x = d.incX;
    pivot.rotation.z = d.incZ;
    pivot.rotation.y = Math.random()*Math.PI*2;
    sunGroup.add(pivot);

    const planetTex = textureLoader.load(d.texture);
    planetTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: planetTex,
      metalness:0.1, roughness:0.85
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.size, 32, 32), mat);
    mesh.position.set(d.radius, 0, 0);
    mesh.rotation.z = (Math.random()-0.5)*0.4;
    mesh.userData = d;
    pivot.add(mesh);

    if(d.ring){
      const ringGeo = new THREE.RingGeometry(d.size*1.7, d.size*2.7, 64);
      const ringTex = textureLoader.load(d.ringTexture);
      const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent:true, side:THREE.DoubleSide });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI/2.3;
      mesh.add(ringMesh);
    }

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexWarm, color:d.accent, transparent:true, opacity:0.32, blending:THREE.AdditiveBlending }));
    glow.scale.set(d.size*6, d.size*6, 1);
    mesh.add(glow);

    pivot.userData = { speed:d.speed };
    nodeMeshes.push(mesh);

    // ---- satellites: each moon orbits its planet, carrying its own label/desc ----
    if(d.moons && d.moons.length){
      d.moons.forEach(m => {
        const moonPivot = new THREE.Object3D();
        moonPivot.rotation.x = (Math.random()-0.5)*0.6;
        moonPivot.rotation.y = Math.random()*Math.PI*2;
        mesh.add(moonPivot);

        const moonTex = m.texture
          ? (() => { const tx = textureLoader.load(m.texture); tx.colorSpace = THREE.SRGBColorSpace; return tx; })()
          : makePlanetTexture(d.accent, d.base, false); // fallback to procedural if no real texture given
        const moonMat = new THREE.MeshStandardMaterial({
          map: moonTex,
          metalness:0.05, roughness:0.95
        });
        const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(m.size, 16, 16), moonMat);
        moonMesh.position.set(m.dist, 0, 0);
        moonMesh.userData = { planet:m.name, label:m.label, desc:m.desc };
        moonPivot.add(moonMesh);

        const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexWarm, color:d.accent, transparent:true, opacity:0.22, blending:THREE.AdditiveBlending }));
        moonGlow.scale.set(m.size*5, m.size*5, 1);
        moonMesh.add(moonGlow);

        nodeMeshes.push(moonMesh);
        moonPivots.push({ pivot:moonPivot, speed:m.speed });
      });
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]);
    const lineMat = new THREE.LineBasicMaterial({ color:d.accent, transparent:true, opacity:0.16 });
    const line = new THREE.Line(lineGeo, lineMat);
    scene.add(line);
    traceLines.push({ line, pivot, mesh });
  });

  // ---- distant starfield (further out, dimmer, unaffected by fog, for extra depth) ----
  const farStarCount = 1000;
  const farStarGeo = new THREE.BufferGeometry();
  const farStarPos = new Float32Array(farStarCount*3);
  for(let i=0;i<farStarCount;i++){
    const r = 60 + Math.random()*90;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos((Math.random()*2)-1);
    farStarPos[i*3] = r*Math.sin(phi)*Math.cos(theta);
    farStarPos[i*3+1] = r*Math.sin(phi)*Math.sin(theta);
    farStarPos[i*3+2] = r*Math.cos(phi);
  }
  farStarGeo.setAttribute('position', new THREE.BufferAttribute(farStarPos,3));
  const farStarMat = new THREE.PointsMaterial({ color:0x9fb6e0, size:0.03, transparent:true, opacity:0.5, fog:false });
  const farStars = new THREE.Points(farStarGeo, farStarMat);
  scene.add(farStars);

  // ---- comet: a lone visitor on a long, eccentric orbit around the sun ----
  const cometPivot = new THREE.Object3D();
  cometPivot.rotation.x = 0.85;
  cometPivot.rotation.z = 0.35;
  sunGroup.add(cometPivot);

  const glowTexIce = glowTexture('#cdeeff');

  const cometMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    new THREE.MeshBasicMaterial({ color:0xe8f7ff })
  );
  cometMesh.userData = { planet:'Comet', label:'Uptime', desc:'Swings by every so often — much like a build that finally stays green.' };
  cometPivot.add(cometMesh);
  nodeMeshes.push(cometMesh);

  const cometComa = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTexIce, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending }));
  cometComa.scale.set(1.3,1.3,1);
  cometMesh.add(cometComa);

  function makeTailTexture(){
    const w=64, h=256;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'rgba(225,245,255,0.85)');
    g.addColorStop(0.4,'rgba(180,220,255,0.3)');
    g.addColorStop(1,'rgba(180,220,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    return new THREE.CanvasTexture(c);
  }
  const TAIL_BASE_HEIGHT = 4;
  const tailGeo = new THREE.ConeGeometry(0.45, TAIL_BASE_HEIGHT, 14, 1, true);
  const tailMat = new THREE.MeshBasicMaterial({
    map: makeTailTexture(), transparent:true, opacity:0.8,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, fog:false
  });
  const cometTail = new THREE.Mesh(tailGeo, tailMat);
  scene.add(cometTail);

  const comet = {
    a: 14, e: 0.86, theta: 0.4, angularConst: 6.5,
    pivot: cometPivot, mesh: cometMesh, tail: cometTail
  };

  // ---- interaction: drag to rotate ----
  let isDragging = false;
  let prevX = 0, prevY = 0;
  let dragMoved = 0;
  let velX = 0, velY = 0;

  canvas.style.pointerEvents = 'auto';
  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true; dragMoved = 0;
    prevX = e.clientX; prevY = e.clientY;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('pointerup', (e) => {
    if(isDragging && dragMoved < 6){ handleClick(e); }
    isDragging = false;
    canvas.style.cursor = 'grab';
  });
  window.addEventListener('pointermove', (e) => {
    if(isDragging){
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      dragMoved += Math.abs(dx)+Math.abs(dy);
      velY = dx * 0.005;
      velX = dy * 0.005;
      root.rotation.y += velY;
      root.rotation.x = Math.max(-0.6, Math.min(0.6, root.rotation.x + velX));
      prevX = e.clientX; prevY = e.clientY;
      tooltip.style.opacity = '0';
      hoveredObject = null;
    } else {
      mouseX = (e.clientX/window.innerWidth - 0.5);
      mouseY = (e.clientY/window.innerHeight - 0.5);
      handleHover(e);
    }
  });

  window.addEventListener('pointerleave', () => {
    tooltip.style.opacity = '0';
    hoveredObject = null;
    canvas.style.cursor = 'grab';
  });

  let mouseX = 0, mouseY = 0;

  // ---- hover / click -> tooltip via raycast ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById('tooltip');
  let tooltipTimeout;
  let hoveredObject = null;
  let lastPointerEvent = null;

  function showTooltip(d, x, y){
    tooltip.innerHTML = '<div class="t-title">'+d.planet+' — '+d.label+'</div><div class="t-body">'+d.desc+'</div>';
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    tooltip.style.opacity = '1';
  }

  let lastClientX = 0, lastClientY = 0;

  function handleHover(e){
    lastPointerEvent = e;
    lastClientX = e.clientX; lastClientY = e.clientY;
    pointer.x = (e.clientX/window.innerWidth)*2 - 1;
    pointer.y = -(e.clientY/window.innerHeight)*2 + 1;
    refreshHover();
  }

  function refreshHover(){
    if(!lastPointerEvent) return;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(nodeMeshes);
    clearTimeout(tooltipTimeout);
    if(hits.length){
      hoveredObject = hits[0].object;
      showTooltip(hoveredObject.userData, lastClientX, lastClientY);
      canvas.style.cursor = 'pointer';
    } else {
      hoveredObject = null;
      tooltip.style.opacity = '0';
      canvas.style.cursor = 'grab';
    }
  }

  function handleClick(e){
    pointer.x = (e.clientX/window.innerWidth)*2 - 1;
    pointer.y = -(e.clientY/window.innerHeight)*2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(nodeMeshes);
    if(hits.length){
      const d = hits[0].object.userData;
      showTooltip(d, e.clientX, e.clientY);
      clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(()=>{ if(!hoveredObject) tooltip.style.opacity = '0'; }, 3200);
    } else {
      tooltip.style.opacity = '0';
    }
  }

  // ---- resize ----
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- scroll drives the camera out through the system ----
  let scrollT = 0;
  function updateScroll(){
    const max = document.documentElement.scrollHeight - window.innerHeight;
    scrollT = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  window.addEventListener('scroll', updateScroll, { passive:true });
  updateScroll();

  const camTarget = new THREE.Vector3();
  const lerp = (a,b,t) => a + (b-a)*t;
  const smoothstep = (e0,e1,x) => { const t = Math.min(1, Math.max(0, (x-e0)/(e1-e0))); return t*t*(3-2*t); };

  // ---- animate ----
  const clock = new THREE.Clock();
  function animate(){
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const speedScale = reduceMotion ? 0.15 : 1;
    const t = performance.now()*0.001;

    // computed early so it can also govern the sun's own scale as the view pulls
    // back to galactic scale — without this the sun stays a giant sphere next to
    // galaxy "stars" that are just tiny points
    const galaxyT = smoothstep(0.55, 1.0, scrollT);
    const sunShrink = 1 - galaxyT*0.9;

    sunMesh.rotation.y += dt*0.04*speedScale;
    sunMesh.scale.setScalar(sunShrink);
    stars.rotation.y += dt*0.008*speedScale;
    belt.rotation.y += dt*0.03*speedScale;

    const pulse = 1 + Math.sin(t*1.4)*0.08;
    corona.scale.set(9*pulse*sunShrink, 9*pulse*sunShrink, 1);
    coreGlow.scale.set(5.6*sunShrink, 5.6*sunShrink, 1);
    coreGlow.material.opacity = (0.5 + Math.sin(t*1.8)*0.08) * (1 - galaxyT*0.25);
    sunLight.intensity = 3.2 * (1 - galaxyT*0.65);

    if(!isDragging){
      root.rotation.y += dt*0.035*speedScale;
      root.rotation.x += (mouseY*0.2 - root.rotation.x)*0.02;
    } else {
      velX *= 0.9; velY *= 0.9;
    }

    traceLines.forEach(tr => {
      tr.pivot.rotation.y += dt * tr.pivot.userData.speed * speedScale;
      const nodeWorldPos = new THREE.Vector3();
      tr.mesh.getWorldPosition(nodeWorldPos);
      const sunWorldPos = new THREE.Vector3();
      sunGroup.getWorldPosition(sunWorldPos);
      const positions = tr.line.geometry.attributes.position.array;
      positions[0]=sunWorldPos.x; positions[1]=sunWorldPos.y; positions[2]=sunWorldPos.z;
      positions[3]=nodeWorldPos.x; positions[4]=nodeWorldPos.y; positions[5]=nodeWorldPos.z;
      tr.line.geometry.attributes.position.needsUpdate = true;
    });

    // moons orbit their parent planet
    moonPivots.forEach(mp => {
      mp.pivot.rotation.y += dt * mp.speed * speedScale;
    });

    farStars.rotation.y += dt*0.003*speedScale;

    // comet: eccentric orbit, faster near the sun, tail always pointing away from it
    {
      const rNow = comet.a * (1 - comet.e*comet.e) / (1 + comet.e*Math.cos(comet.theta));
      comet.theta += (comet.angularConst / (rNow*rNow)) * dt * speedScale;
      comet.mesh.position.set(rNow*Math.cos(comet.theta), 0, rNow*Math.sin(comet.theta));

      const nucleusWorld = new THREE.Vector3();
      comet.mesh.getWorldPosition(nucleusWorld);
      const sunWorldPos2 = new THREE.Vector3();
      sunGroup.getWorldPosition(sunWorldPos2);
      const awayDir = nucleusWorld.clone().sub(sunWorldPos2).normalize();

      const closeness = 1 - Math.min(rNow / comet.a, 1);
      const tailLength = 2.6 + closeness*4.5;
      comet.tail.scale.set(0.6 + closeness*0.8, tailLength / TAIL_BASE_HEIGHT, 0.6 + closeness*0.8);
      comet.tail.position.copy(nucleusWorld).add(awayDir.clone().multiplyScalar(tailLength/2));
      comet.tail.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), awayDir.clone().negate());
      comet.tail.material.opacity = 0.5 + closeness*0.4;
    }

    // Andromeda drifts slowly around Sagittarius A*'s frame — a full galactic
    // rotation takes far longer than any local orbit, so this stays gentle.
    // Everything belonging to the galaxy (stars, glow layers, dust, companions)
    // is nested under galaxyGroup so it all turns together.
    galaxyGroup.rotation.y += dt*0.004*speedScale;
    galaxy.rotation.y += dt*0.006*speedScale;

    galaxy.material.opacity = galaxyT*0.85;
    galaxyHalo.material.opacity = galaxyT*0.5;
    galaxyBulgeGlow.material.opacity = galaxyT*0.55;
    galaxyCoreHot.material.opacity = galaxyT*0.6;
    dustLane1.material.opacity = galaxyT*0.7;
    dustLane2.material.opacity = galaxyT*0.55;
    companionM32.material.opacity = galaxyT*0.7;
    companionM110.material.opacity = galaxyT*0.45;

    scene.fog.density = 0.013 - galaxyT*0.009;

    // the black hole belongs strictly to the galaxy-scale shot — kept fully hidden
    // until the camera has actually pulled back, so it never appears behind the
    // solar system during the close-up view
    blackHole.visible = galaxyT > 0.015;
    accretionDisk.rotation.z += dt*0.3*speedScale;
    diskMat.opacity = galaxyT*0.9;
    holeGlow.material.opacity = galaxyT*0.35;

    // the camera's focus glides from the sun (its own local view) toward the
    // true galactic center — where the black hole sits — as the view pulls back
    const sunWorldPos = new THREE.Vector3();
    sunGroup.getWorldPosition(sunWorldPos);
    const focusPoint = sunWorldPos.clone().lerp(new THREE.Vector3(0,0,0), galaxyT);

    // pulled shallow and low over the disk in the galaxy phase, so the flattened
    // spiral reads as an elongated, tilted ellipse — the classic Andromeda look —
    // rather than a flat circle seen from directly above
    camTarget.set(
      focusPoint.x + (Math.sin(scrollT*2.1) * lerp(0, 8, scrollT)) * (1 - galaxyT*0.7) + mouseX*1.2,
      focusPoint.y + lerp(0.6, 6, scrollT) + lerp(0, 22, galaxyT),
      focusPoint.z + lerp(9, 32, scrollT) + lerp(0, 80, galaxyT)
    );
    camera.position.lerp(camTarget, 0.05);
    camera.lookAt(focusPoint);

    if(!isDragging) refreshHover();

    renderer.render(scene, camera);
  }
  animate();
})();