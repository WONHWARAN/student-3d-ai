import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js";
import {OrbitControls} from "https://cdn.jsdelivr.net/npm/three@0.179.1/examples/jsm/controls/OrbitControls.js";

const input=document.querySelector("#fileInput");
const preview=document.querySelector("#preview");
const makeBtn=document.querySelector("#make3d");
const status=document.querySelector("#status");
const viewer=document.querySelector("#viewer");
const depth=document.querySelector("#depth");
const resolution=document.querySelector("#resolution");
let image=null, renderer, scene, camera, controls, mesh;

function initViewer(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x10141d);
  camera=new THREE.PerspectiveCamera(45,viewer.clientWidth/viewer.clientHeight,.1,100);
  camera.position.set(0,2.2,5);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(viewer.clientWidth,viewer.clientHeight);
  viewer.innerHTML="";
  viewer.appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2.5));
  const light=new THREE.DirectionalLight(0xffffff,2);
  light.position.set(3,5,4); scene.add(light);
  const grid=new THREE.GridHelper(8,20,0x334155,0x1e293b); scene.add(grid);
  addEventListener("resize",()=>{
    camera.aspect=viewer.clientWidth/viewer.clientHeight;
    camera.updateProjectionMatrix(); renderer.setSize(viewer.clientWidth,viewer.clientHeight);
  });
  (function loop(){requestAnimationFrame(loop);controls.update();renderer.render(scene,camera)})();
}
initViewer();

input.addEventListener("change",e=>loadFile(e.target.files[0]));
document.querySelector("#dropzone").addEventListener("dragover",e=>{e.preventDefault()});
document.querySelector("#dropzone").addEventListener("drop",e=>{e.preventDefault();loadFile(e.dataTransfer.files[0])});

function loadFile(file){
  if(!file || !file.type.startsWith("image/")) return;
  const url=URL.createObjectURL(file);
  preview.src=url; preview.style.display="block"; makeBtn.disabled=false;
  status.textContent="그림을 확인했습니다. 3D 모델을 만들어 보세요.";
  image=new Image(); image.src=url;
}
makeBtn.addEventListener("click",make3D);

function make3D(){
  if(!image) return;
  status.textContent="3D 모델 생성 중…";
  if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  const r=+resolution.value, canvas=document.createElement("canvas"), ctx=canvas.getContext("2d");
  const aspect=image.width/image.height;
  let w=r,h=Math.max(8,Math.round(r/aspect));
  if(w>128){w=128;h=Math.max(8,Math.round(w/aspect))}
  canvas.width=w;canvas.height=h;
  ctx.drawImage(image,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h).data;
  const geo=new THREE.PlaneGeometry(5,5/aspect,w-1,h-1);
  const pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=i%w,y=Math.floor(i/w),p=(y*w+x)*4;
    const brightness=(pixels[p]+pixels[p+1]+pixels[p+2])/765;
    const alpha=pixels[p+3]/255;
    const z=(1-brightness)*+depth.value*2.2*alpha;
    pos.setZ(i,z);
  }
  geo.computeVertexNormals();
  const tex=new THREE.TextureLoader().load(preview.src);
  tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshStandardMaterial({map:tex,side:THREE.DoubleSide,roughness:.72,metalness:.05});
  mesh=new THREE.Mesh(geo,mat);
  mesh.rotation.x=-Math.PI/2;
  scene.add(mesh);
  status.textContent="완성! 마우스로 돌려보세요.";
}
