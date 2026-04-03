import React from 'react';

const I = (d, s=18, sw=1.5, fill='none') => React.createElement('svg',{width:s,height:s,viewBox:'0 0 24 24',fill:fill,stroke:'currentColor',strokeWidth:sw,strokeLinecap:'round',strokeLinejoin:'round',style:{display:'inline-block',verticalAlign:'middle',flexShrink:0}},
  ...(Array.isArray(d)?d:[d]).map((p,i)=>{
    if(typeof p==='string') return React.createElement('path',{key:i,d:p});
    const{tag,...attrs}=p;return React.createElement(tag||'path',{key:i,...attrs});
  })
);
const Icon = {
  clipboard:(s=18)=>I(['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',{tag:'rect',x:'8',y:'2',width:'8',height:'4',rx:'1',ry:'1'}],s),
  fileText:(s=18)=>I(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z','M14 2v6h6','M16 13H8','M16 17H8','M10 9H8'],s),
  messageCircle:(s=18)=>I('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',s),
  link:(s=18)=>I(['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],s),
  sparkles:(s=18)=>I(['M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z','M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z'],s),
  camera:(s=18)=>I(['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',{tag:'circle',cx:'12',cy:'13',r:'4'}],s),
  send:(s=18)=>I(['M22 2L11 13','M22 2l-7 20-4-9-9-4 20-7z'],s),
  calendar:(s=18)=>I([{tag:'rect',x:'3',y:'4',width:'18',height:'18',rx:'2',ry:'2'},'M16 2v4','M8 2v4','M3 10h18'],s),
  clock:(s=18)=>I([{tag:'circle',cx:'12',cy:'12',r:'10'},'M12 6v6l4 2'],s),
  calendarClock:(s=18)=>I([{tag:'rect',x:'3',y:'4',width:'18',height:'18',rx:'2',ry:'2'},'M16 2v4','M8 2v4','M3 10h18','M12 14v2l1.5 1.5'],s),
  checkCircle:(s=18)=>I(['M22 11.08V12a10 10 0 1 1-5.93-9.14','M22 4L12 14.01l-3-3'],s),
  scissors:(s=18)=>I([{tag:'circle',cx:'6',cy:'6',r:'3'},{tag:'circle',cx:'6',cy:'18',r:'3'},'M20 4L8.12 15.88','M14.47 14.48L20 20','M8.12 8.12L12 12'],s),
  trash:(s=18)=>I(['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2','M10 11v6','M14 11v6'],s),
  zap:(s=18)=>I('M13 2L3 14h9l-1 8 10-12h-9l1-8z',s,1.5,'none'),
  helpCircle:(s=18)=>I([{tag:'circle',cx:'12',cy:'12',r:'10'},'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3','M12 17h.01'],s),
  layers:(s=18)=>I(['M12 2L2 7l10 5 10-5-10-5z','M2 17l10 5 10-5','M2 12l10 5 10-5'],s),
  listTree:(s=18)=>I(['M21 12H9','M21 6H9','M21 18H9','M5 6v.01','M5 12v.01','M5 18v.01'],s),
  hammer:(s=18)=>I(['M15 12l-8.5 8.5c-.83.83-2.17.83-3 0s-.83-2.17 0-3L12 9','M17.64 15L22 10.64','M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V6.5a.5.5 0 0 0-.5-.5H16.2c-.85 0-1.65-.33-2.25-.93l-1.25-1.25c-.6-.6-1.57-.6-2.17 0L8.5 5.85c-.6.6-.6 1.57 0 2.17L12 11.5'],s),
  trophy:(s=18)=>I(['M6 9H4.5a2.5 2.5 0 0 1 0-5H6','M18 9h1.5a2.5 2.5 0 0 0 0-5H18',{tag:'rect',x:'6',y:'2',width:'12',height:'10',rx:'2'},'M12 12v4','M8 20h8','M10 16h4'],s),
  thumbsUp:(s=18)=>I(['M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z','M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'],s),
  bookOpen:(s=18)=>I(['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z','M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],s),
  alertTriangle:(s=18)=>I(['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z','M12 9v4','M12 17h.01'],s),
  circleDot:(s=18)=>I([{tag:'circle',cx:'12',cy:'12',r:'10'},{tag:'circle',cx:'12',cy:'12',r:'3',fill:'currentColor'}],s),
  circle:(s=18)=>I([{tag:'circle',cx:'12',cy:'12',r:'10'}],s),
  maximize:(s=18)=>I(['M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'],s),
  minimize:(s=18)=>I(['M4 14h6v6','M20 10h-6V4','M14 10l7-7','M3 21l7-7'],s),
  chevronLeft:(s=18)=>I('M15 18l-6-6 6-6',s,2),
  chevronRight:(s=18)=>I('M9 18l6-6-6-6',s,2),
  arrowLeft:(s=18)=>I(['M19 12H5','M12 19l-7-7 7-7'],s),
  arrowRight:(s=18)=>I(['M5 12h14','M12 5l7 7-7 7'],s),
  mail:(s=18)=>I([{tag:'rect',x:'2',y:'4',width:'20',height:'16',rx:'2'},'M22 7l-10 7L2 7'],s),
  check:(s=18)=>I('M20 6L9 17l-5-5',s,2),
  x:(s=18)=>I(['M18 6L6 18','M6 6l12 12'],s,2),
  sun:(s=18)=>I([{tag:'circle',cx:'12',cy:'12',r:'5'},'M12 1v2','M12 21v2','M4.22 4.22l1.42 1.42','M18.36 18.36l1.42 1.42','M1 12h2','M21 12h2','M4.22 19.78l1.42-1.42','M18.36 5.64l1.42-1.42'],s),
  cloud:(s=18)=>I('M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',s),
  cloudFog:(s=18)=>I(['M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25','M8 19h8','M8 23h8'],s),
  cloudRain:(s=18)=>I(['M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25','M16 14v6','M8 14v6','M12 16v6'],s),
  cloudSnow:(s=18)=>I(['M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25','M8 16h.01','M8 20h.01','M12 18h.01','M12 22h.01','M16 16h.01','M16 20h.01'],s,1.5),
  cloudDrizzle:(s=18)=>I(['M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25','M8 17v1','M8 21v1','M12 15v1','M12 19v1','M16 17v1','M16 21v1'],s),
  cloudLightning:(s=18)=>I(['M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9','M13 11l-4 6h6l-4 6'],s),
  search:(s=18)=>I([{tag:'circle',cx:'11',cy:'11',r:'8'},'M21 21l-4.35-4.35'],s),
  plus:(s=18)=>I(['M12 5v14','M5 12h14'],s,2),
  edit:(s=18)=>I(['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7','M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'],s),
  logout:(s=18)=>I(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4','M16 17l5-5-5-5','M21 12H9'],s),
  mic:(s=18)=>I(['M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z','M19 10v2a7 7 0 0 1-14 0v-2','M12 19v4','M8 23h8'],s),
  micOff:(s=18)=>I(['M1 1l22 22','M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6','M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17','M12 19v4','M8 23h8'],s),
  panel:(s=18)=>I([{tag:'rect',x:'3',y:'3',width:'18',height:'18',rx:'5',ry:'5'},'M10 3v18'],s),
  headphones:(s=18)=>I(['M3 18v-6a9 9 0 0 1 18 0v6',{tag:'rect',x:'1',y:'16',width:'5',height:'6',rx:'1'},{tag:'rect',x:'18',y:'16',width:'5',height:'6',rx:'1'}],s),
  video:(s=18)=>I([{tag:'rect',x:'2',y:'5',width:'15',height:'14',rx:'2',ry:'2'},'M23 7l-7 5 7 5V7z'],s),
};

export { Icon, I };
export default Icon;
